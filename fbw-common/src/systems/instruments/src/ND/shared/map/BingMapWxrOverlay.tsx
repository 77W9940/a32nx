// @ts-strict-ignore
// Copyright (c) 2024-2026 FlyByWire Simulations
//
// SPDX-License-Identifier: GPL-3.0

import {
  DisplayComponent,
  FSComponent,
  Subject,
  Subscribable,
  VNode,
} from '@microsoft/msfs-sdk';
import { EfisNdMode } from '@flybywiresim/fbw-sdk';

export interface BingMapWxrOverlayProps {
  visible: Subscribable<boolean>;
  centerLat: Subscribable<number>;
  centerLong: Subscribable<number>;
  yBias: Subscribable<number>;
  range: Subscribable<number>;
  ndMode: Subscribable<EfisNdMode>;
}

const ROSE_CLIP = 'rect(246px, 990px, 900px, 0px)';

const RANGE_CONSTANT = 1852;

export class BingMapWxrOverlay extends DisplayComponent<BingMapWxrOverlayProps> {
  private readonly mapRef = FSComponent.createRef<BingMapElement>();

  private readonly wrapperStyle = Subject.create('display: none;');

  private isDestroyed = false;

  private isInit = false;

  private isWxrOn = false;

  private lastParamsUpdateTs = 0;

  private static readonly CONFIG_FOLDER = '/Pages/VCockpit/Instruments/Airliners/FlyByWire_A380/EFB/';

  private static readonly WXR_CONE = Math.PI;

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);

    window.addEventListener('OnDestroy', this.destroy.bind(this));

    if (typeof SvgMapConfig === 'undefined') {
      return;
    }

    const svgMapConfig = new SvgMapConfig();
    svgMapConfig.load(BingMapWxrOverlay.CONFIG_FOLDER, () => {
      if (this.isDestroyed || !this.mapRef.instance) {
        return;
      }

      this.mapRef.instance.setBingId('a380x_wxr');
      this.mapRef.instance.setVisible(false);
      svgMapConfig.generateBingMap(this.mapRef.instance);
      this.mapRef.instance.setConfig(0);
      this.mapRef.instance.setMode(EBingMode.PLANE);
      this.mapRef.instance.setReference(EBingReference.SEA);
      this.isInit = true;

      this.updateMapParams();

      if (this.props.visible.get()) {
        this.wake();
      }
    });

    this.props.visible.sub((v) => {
      if (v) {
        this.wake();
      } else {
        this.sleep();
      }
    });

    this.props.centerLat.sub(() => this.updateMapParams());
    this.props.centerLong.sub(() => this.updateMapParams());
    this.props.range.sub(() => this.updateMapParams());

    this.props.ndMode.sub((mode) => {
      this.applyClip(mode);
    }, true);

    this.props.yBias.sub(() => {
      this.applyClip(this.props.ndMode.get());
    }, true);
  }

  private applyClip(mode: EfisNdMode): void {
    if (this.isDestroyed) return;
    const yBias = this.props.yBias.get() || 0;
    const blend = 'mix-blend-mode: lighten;';
    if (mode === EfisNdMode.PLAN) {
      this.wrapperStyle.set('display: none;');
    } else if (mode === EfisNdMode.ARC) {
      this.wrapperStyle.set(`display: block; position: absolute; top: 128px; left: -111px; width: 990px; height: 990px; ${blend} clip: unset;`);
    } else {
      this.wrapperStyle.set(`display: block; position: absolute; top: -115px; left: -110px; width: 990px; height: 990px; ${blend} clip: ${ROSE_CLIP};`);
    }
  }

  private wake(): void {
    if (this.isWxrOn || !this.isInit || !this.mapRef.instance) return;
    this.isWxrOn = true;
    this.mapRef.instance.showWeather('Horizontal', BingMapWxrOverlay.WXR_CONE);
    this.mapRef.instance.setVisible(true);
    this.applyClip(this.props.ndMode.get());
  }

  private sleep(): void {
    if (!this.isWxrOn || !this.isInit || !this.mapRef.instance) return;
    this.isWxrOn = false;
    this.wrapperStyle.set('display: none;');
    this.mapRef.instance.showWeather('Off', BingMapWxrOverlay.WXR_CONE);
    this.mapRef.instance.setVisible(false);
  }

  private updateMapParams(): void {
    if (!this.isInit || !this.mapRef.instance) return;
    if (Date.now() - this.lastParamsUpdateTs < 250) return;
    this.lastParamsUpdateTs = Date.now();

    const lat = this.props.centerLat.get();
    const long = this.props.centerLong.get();
    const rangeNm = this.props.range.get();
    if (!Number.isFinite(lat) || !Number.isFinite(long) || rangeNm <= 0) return;

    const lla = new LatLongAlt(lat, long);
    const radius = rangeNm * RANGE_CONSTANT;
    this.mapRef.instance.setParams({ lla, radius });
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.sleep();
    window.removeEventListener('OnDestroy', this.destroy.bind(this));
  }

  render(): VNode {
    return (
      <div style={this.wrapperStyle}>
        <bing-map ref={this.mapRef} style="width: 100%; height: 100%;" />
      </div>
    );
  }
}
