// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { ComponentProps, DisplayComponent, FSComponent, VNode } from '@microsoft/msfs-sdk';
import { AmdbProperties, FeatureType } from '@flybywiresim/fbw-sdk';
import { Feature, FeatureCollection, Geometry, LineString, Polygon, Position } from 'geojson';
import { LAYER_SPECIFICATIONS } from './style-data';

// Not imported from Oanc.tsx (which itself imports this file) to avoid a circular value import - these must match
// Oanc.OANC_RENDER_WIDTH/OANC_RENDER_HEIGHT.
const OANC_RENDER_WIDTH = 768;
const OANC_RENDER_HEIGHT = 768;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OancStaticCanvasLayerProps extends ComponentProps {}

/**
 * How far, in pixels, the buffer extends past the visible OANC_RENDER_WIDTH/HEIGHT viewport on each side, at the
 * buffer's own (unrotated) scale. Two things need covering: PAN_MARGIN_PX is headroom for the view drifting away
 * from where the buffer was last drawn (aircraft movement in ARC-follow mode, or manual pan) before a redraw is
 * forced, and ROTATION_COVERAGE_RADIUS_PX is what a filled square needs so its inscribed circle (radius
 * BUFFER_HALF_SIZE, invariant to how the square itself is rotated about its own center) still covers the viewport's
 * farthest corner (half its diagonal) at any heading, since the whole buffer is CSS-rotated as a single rigid image
 * - see the class doc for why redrawing on rotation is not needed at all anymore.
 */
const PAN_MARGIN_PX = 2800;
const ROTATION_COVERAGE_RADIUS_PX = (Math.hypot(OANC_RENDER_WIDTH, OANC_RENDER_HEIGHT) / 2) * 1.02; // +2% safety
const BUFFER_SIZE = Math.ceil((ROTATION_COVERAGE_RADIUS_PX + PAN_MARGIN_PX) * 2);
const BUFFER_HALF_SIZE = BUFFER_SIZE / 2;

/** Fraction of PAN_MARGIN_PX at which a recenter-redraw is forced, so the buffer's edge is never actually visible. */
const PAN_REDRAW_MARGIN_FRACTION = 0.5;

/**
 * Renders the static (non-BTV) OANC feature layers into a single fixed-size, plain canvas - not sized to the
 * airport, so VRAM cost stays constant regardless of airport size.
 *
 * Deliberately does NOT use the SDK's MapCachedCanvasLayer/MapProjection (a Mercator-based geo-projection). OANS's
 * DOM labels and BTV interactivity are already built on Oanc.projectPoint() - a flat, ARP-relative bearing/distance
 * projection, a different (and incompatible) family from Mercator.
 *
 * Draw/display model, matching the actual redraw-avoidance mechanism the stock SDK's own MapCachedCanvasLayer uses
 * (verified by reading its real implementation - the 787's own MapCustomTaxiwayLayer sits on top of the unmodified
 * SDK class): the buffer is drawn ONCE, with the REFERENCE POINT (the aircraft, in ARC-follow mode - a normal state,
 * not an edge case) at the buffer's own geometric center - so the buffer's real-world coverage always surrounds
 * wherever you actually are, regardless of how far that is from the ARP or how tight the current zoom is. An earlier
 * version centered the buffer on the ARP instead, on the theory that keeping content-center and rotation-pivot as
 * the same point would be simpler/safer - but that reintroduces a real coverage bug: a buffer's real-world radius
 * shrinks fast at high zoom, and if the aircraft is more than a few hundred meters from the ARP (routine on a large
 * airport), tight zoom can put you entirely outside an ARP-centered buffer's drawn content. No amount of redrawing
 * fixes that, since an ARP-centered buffer always draws the same ARP-relative region regardless of where you are.
 *
 * Rotation still needs to pivot on the ARP specifically (that's what Oanc.projectPoint() does, and DOM labels/BTV
 * are built on it), which is no longer the buffer's own center now that content is reference-centered. Rather than
 * pointing a custom `transform-origin` at the ARP's position within the buffer (tried previously; unreliable in this
 * engine for reasons never conclusively pinned down - Coherent GT is not a fully spec-standard browser), the pivot
 * is instead expressed entirely within the `transform` function list itself:
 * `translate(dx, dy) rotate(headingDeg) translate(-pivotX, -pivotY)` - shift the ARP's buffer-local position to the
 * origin, rotate around the origin, then shift to the ARP's actual current screen position. This is algebraically
 * identical to setting transform-origin to the same point (verified), but expressed as three ordinary transform
 * functions instead of a separate CSS property - not necessarily faster, but a mechanically different code path in
 * the browser that might not share whatever broke the transform-origin approach.
 *
 * Either way, rotation is a pure CSS transform, at ZERO redraw cost, matching the SDK exactly - verified directly in
 * MapCachedCanvasLayerCanvasInstanceClass.updateTransform(), whose only invalidation conditions are an extreme zoom
 * change or the pan margin being exceeded; rotation is applied unconditionally, every call, with no check at all.
 * Redraws here happen only when they must: the airport or zoom band changed, or the view has drifted (aircraft
 * movement or manual pan) past the buffer's pan margin.
 */
export class OancStaticCanvasLayer extends DisplayComponent<OancStaticCanvasLayerProps> {
  private readonly canvasRef = FSComponent.createRef<HTMLCanvasElement>();

  private layerFeatures: FeatureCollection<Geometry, AmdbProperties>[] = [];

  private hasAirportData = false;

  private zoomLevelIndex = 0;

  private needRedraw = false;

  private lastAirportKey: string | null = null;

  private lastZoomLevelIndex = -1;

  /** ARP's own projected screen position (Oanc.projectPoint([0, 0])) as of the last redraw - see the class doc. */
  private lastRedrawArpX = 0;

  private lastRedrawArpY = 0;

  /** scale/offsetX/Y as of the last redraw - set right before redraw() is called, used by projectLocalPoint(). */
  private redrawScale = 0;

  private redrawOffsetX = 0;

  private redrawOffsetY = 0;

  /**
   * The ARP's own buffer-local pixel position as of the last redraw - see the class doc's `translate() rotate()
   * translate()` explanation. Frozen between redraws (like redrawScale) since it depends on offsetX/Y, which is
   * only sampled at redraw time.
   */
  private redrawPivotX = 0;

  private redrawPivotY = 0;

  /**
   * Updates the feature data this layer draws. Triggers a redraw only if the airport has changed - callers should
   * not call this every frame if nothing changed (it's cheap to call, but the redraw it may trigger is not free
   * to skip checking against the AMDB feature array reference).
   */
  public setAirportData(
    hasAirportData: boolean,
    layerFeatures: FeatureCollection<Geometry, AmdbProperties>[],
    airportKey: string | null,
  ): void {
    this.hasAirportData = hasAirportData;
    this.layerFeatures = layerFeatures;

    if (airportKey !== this.lastAirportKey) {
      this.lastAirportKey = airportKey;
      this.needRedraw = true;
    }
  }

  /** Updates the current OANS zoom level index (0-4). Triggers a redraw if the zoom band actually changed. */
  public setZoomLevelIndex(zoomLevelIndex: number): void {
    this.zoomLevelIndex = zoomLevelIndex;

    if (zoomLevelIndex !== this.lastZoomLevelIndex) {
      this.lastZoomLevelIndex = zoomLevelIndex;
      this.needRedraw = true;
    }
  }

  /** Forces a redraw on the next update(), e.g. after an airport unload/clear. */
  public requestRedraw(): void {
    this.needRedraw = true;
  }

  /**
   * Called once per frame from Oanc.tsx's Update(). arpProjected is projectPoint([0, 0]) - where the ARP currently
   * projects on screen, i.e. the feature-independent translation term of projectPoint()'s formula (rotating the
   * origin about itself is a no-op, so only the pan/offset terms remain, which is exactly why it's safe to use as
   * the redraw-drift tracker regardless of heading). scale is the current zoom-level inverse scale. offsetX/Y is the
   * reference point's own ARP-relative position, in real meters - the buffer is drawn centered on this, not on the
   * ARP (see class doc for why). headingDeg is the current map heading - never triggers a redraw, only feeds the
   * CSS rotate() (also see class doc).
   *
   * If a redraw is pending - because content changed (requestRedraw()/setAirportData()/setZoomLevelIndex()) or
   * panning has used up most of the buffer's margin - redraws fully (reference-centered - see redraw()'s doc),
   * records the ARP's buffer-local pixel position at this moment (redrawPivotX/Y - the buffer no longer has the ARP
   * at a fixed, known location, since it's not what the content is centered on anymore), and re-anchors the canvas
   * element so the ARP sits exactly at arpProjectedX/Y. The CSS transform is then always
   * translate(dx, dy) rotate(headingDeg) translate(-redrawPivotX, -redrawPivotY) - dx/dy is how far arpProjected has
   * drifted since the last redraw (0 immediately after one). See the class doc for why composing the pivot this way
   * (rather than a `transform-origin` CSS property) is algebraically identical but a different code path.
   *
   * The margin check happens every frame, including mid-drag, and the redraw is synchronous - so a pan that's about
   * to expose the edge of the (fixed-size, overdrawn) canvas triggers a redraw *before* that edge is ever visible,
   * not after the fact. This is deliberately more proactive than e.g. a "redraw on mouse-up" approach, which can
   * show a blank edge for the remainder of an in-progress drag.
   */
  public update(
    arpProjectedX: number,
    arpProjectedY: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    headingDeg: number,
  ): void {
    const dx = arpProjectedX - this.lastRedrawArpX;
    const dy = arpProjectedY - this.lastRedrawArpY;

    if (this.needRedraw || Math.hypot(dx, dy) > PAN_MARGIN_PX * PAN_REDRAW_MARGIN_FRACTION) {
      this.needRedraw = false;
      this.redrawScale = scale;
      // The ARP's buffer-local position under a reference-centered draw (buffer center = local (offsetX, offsetY)):
      // local (0, 0) maps to (BUFFER_HALF_SIZE - offsetX*scale, BUFFER_HALF_SIZE + offsetY*scale) - see
      // projectLocalPoint()'s formula, evaluated at x=y=0.
      this.redrawPivotX = BUFFER_HALF_SIZE - offsetX * scale;
      this.redrawPivotY = BUFFER_HALF_SIZE + offsetY * scale;
      this.redraw(offsetX, offsetY);
      this.lastRedrawArpX = arpProjectedX;
      this.lastRedrawArpY = arpProjectedY;

      // Anchor the canvas element so the ARP's actual current screen position is what the pivot translate() below
      // resolves to at zero drift - see update()'s doc.
      this.canvasRef.instance.style.left = `${arpProjectedX}px`;
      this.canvasRef.instance.style.top = `${arpProjectedY}px`;
      this.canvasRef.instance.style.transform = `translate(0px, 0px) rotate(${headingDeg}deg) translate(${-this.redrawPivotX}px, ${-this.redrawPivotY}px)`;
      return;
    }

    this.canvasRef.instance.style.transform = `translate(${dx}px, ${dy}px) rotate(${headingDeg}deg) translate(${-this.redrawPivotX}px, ${-this.redrawPivotY}px)`;
  }

  /**
   * Redraws every visible layer, centered on the reference point and north-up (heading is never baked into the
   * buffer's own content - see the class doc for why that's fine: heading is applied afterwards as a plain CSS
   * rotate(), composed with a translate() pivot around the ARP's buffer-local position). Vertices are placed with
   * plain multiply/add (this.redrawScale * (x - offsetX) etc.) - no per-vertex trig, no per-vertex heading at all,
   * since the buffer content doesn't depend on heading.
   */
  private redraw(offsetX: number, offsetY: number): void {
    const ctx = this.canvasRef.instance.getContext('2d');

    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, BUFFER_SIZE, BUFFER_SIZE);

    if (!this.hasAirportData) {
      return;
    }

    this.redrawOffsetX = offsetX;
    this.redrawOffsetY = offsetY;

    for (let i = 0; i < this.layerFeatures.length; i++) {
      const layerSpec = LAYER_SPECIFICATIONS[i];
      const layerData = this.layerFeatures[i];

      if (!layerSpec || !layerData || !layerSpec.zoomLevelVisibilities[this.zoomLevelIndex]) {
        continue;
      }

      this.drawLayer(ctx, layerData, layerSpec);
    }
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    data: FeatureCollection<Geometry, AmdbProperties>,
    layerSpec: (typeof LAYER_SPECIFICATIONS)[number],
  ): void {
    for (const feature of data.features) {
      let doStroke = false;
      let doFill = false;

      const matchingRule = layerSpec.styleRules.find((it) => {
        if (feature.properties.feattype === FeatureType.VerticalPolygonalStructure) {
          return (
            it.forFeatureTypes?.includes(feature.properties.feattype) &&
            feature.properties.plysttyp &&
            it.forPolygonStructureTypes?.includes(feature.properties.plysttyp)
          );
        }

        return it.forFeatureTypes?.includes(feature.properties.feattype);
      });

      if (!matchingRule) {
        continue;
      }

      if (matchingRule.styles.doStroke !== undefined) {
        doStroke = matchingRule.styles.doStroke;
      }
      if (matchingRule.styles.doFill !== undefined) {
        doFill = matchingRule.styles.doFill;
      }
      if (matchingRule.styles.strokeStyle !== undefined) {
        ctx.strokeStyle = matchingRule.styles.strokeStyle;
      }
      if (matchingRule.styles.lineWidth !== undefined) {
        ctx.lineWidth = matchingRule.styles.lineWidth;
      }
      if (matchingRule.styles.fillStyle !== undefined) {
        ctx.fillStyle = matchingRule.styles.fillStyle;
      }

      this.drawFeatureGeometry(ctx, feature, doStroke, doFill);
    }
  }

  private drawFeatureGeometry(
    ctx: CanvasRenderingContext2D,
    feature: Feature<Geometry, AmdbProperties>,
    doStroke: boolean,
    doFill: boolean,
  ): void {
    switch (feature.geometry.type) {
      case 'LineString': {
        const path = this.buildPath((feature.geometry as LineString).coordinates);
        if (doFill) {
          ctx.fill(path);
        }
        if (doStroke) {
          ctx.stroke(path);
        }
        break;
      }
      case 'Polygon': {
        for (const outline of (feature.geometry as Polygon).coordinates) {
          const path = this.buildPath(outline);
          if (doFill) {
            ctx.fill(path);
          }
          if (doStroke) {
            ctx.stroke(path);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private buildPath(coordinates: Position[]): Path2D {
    const path = new Path2D();

    for (let i = 0; i < coordinates.length; i++) {
      const [px, py] = this.projectLocalPoint(coordinates[i]);

      if (i === 0) {
        path.moveTo(px, py);
      } else {
        path.lineTo(px, py);
      }
    }

    return path;
  }

  /**
   * Projects a feature vertex into buffer-local pixel coordinates, north-up, centered on the reference point: local
   * (offsetX, offsetY) always lands exactly at (BUFFER_HALF_SIZE, BUFFER_HALF_SIZE) - the buffer's own geometric
   * center - regardless of scale. Heading is applied afterwards, to the whole buffer at once, via a CSS transform
   * pivoting on the ARP - see the class and update() docs.
   */
  private projectLocalPoint(local: Position): readonly [number, number] {
    const [x, y] = local;
    return [
      BUFFER_HALF_SIZE + this.redrawScale * (x - this.redrawOffsetX),
      BUFFER_HALF_SIZE - this.redrawScale * (y - this.redrawOffsetY),
    ];
  }

  /**
   * @inheritdoc
   * left/top here are only an initial placeholder (nothing is drawn until the first redraw() anyway, since
   * hasAirportData starts false) - update() overwrites both on every actual redraw, anchoring the ARP to its real
   * current screen position.
   *
   * transform-origin is pinned to the canvas's own top-left corner (0 0) - a fixed constant, set once, never needing
   * a per-frame update. This is required for the `translate() rotate() translate()` pivot composition in update()'s
   * doc to work out algebraically: CSS's default transform-origin (50% 50%, the box's own center) injects its own
   * offset into a rotate() even when sandwiched between translates, so it has to be neutralized by pinning it to a
   * point (the origin) where that injected offset is exactly zero. Deliberately NOT computing a large, per-redraw,
   * state-dependent transform-origin pixel value here (unlike a prior, unreliable attempt) - "0 0" is a fixed,
   * ordinary constant, about as basic as transform-origin usage gets.
   */
  public render(): VNode {
    return (
      <canvas
        ref={this.canvasRef}
        width={BUFFER_SIZE}
        height={BUFFER_SIZE}
        style={`position: absolute; left: ${OANC_RENDER_WIDTH / 2 - BUFFER_HALF_SIZE}px; top: ${OANC_RENDER_HEIGHT / 2 - BUFFER_HALF_SIZE}px; transform-origin: 0 0;`}
      />
    );
  }
}
