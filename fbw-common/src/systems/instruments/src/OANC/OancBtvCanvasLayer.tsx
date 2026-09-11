// Copyright (c) 2026 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import { ComponentProps, DisplayComponent, FSComponent, VNode } from '@microsoft/msfs-sdk';

// Not imported from Oanc.tsx (which itself imports this file) to avoid a circular value import - these must match
// Oanc.OANC_RENDER_WIDTH/OANC_RENDER_HEIGHT.
const OANC_RENDER_WIDTH = 768;
const OANC_RENDER_HEIGHT = 768;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface OancBtvCanvasLayerProps extends ComponentProps {}

/**
 * TODO(Task 5): currently an empty, undrawn viewport-sized canvas - exists so Oanc.tsx has a ref to pass to
 * OansBrakeToVacateSelection once its draw methods are updated to draw through Oanc.projectPoint() (see
 * OancStaticCanvasLayer's class doc for why - the same reasoning applies here) instead of the old local-meters +
 * context-translate approach. Unlike the static layer, BTV's content changes frequently (stop lines/advisories
 * recompute with aircraft movement), so this one probably won't need the redraw-avoidance/CSS-pan machinery at all -
 * it can likely just redraw every time OansBrakeToVacateSelection has new geometry.
 */
export class OancBtvCanvasLayer extends DisplayComponent<OancBtvCanvasLayerProps> {
  private readonly canvasRef = FSComponent.createRef<HTMLCanvasElement>();

  public getContext(): CanvasRenderingContext2D | null {
    return this.canvasRef.getOrDefault()?.getContext('2d') ?? null;
  }

  /** @inheritdoc */
  public render(): VNode {
    return (
      <canvas ref={this.canvasRef} width={OANC_RENDER_WIDTH} height={OANC_RENDER_HEIGHT} style="position: absolute;" />
    );
  }
}
