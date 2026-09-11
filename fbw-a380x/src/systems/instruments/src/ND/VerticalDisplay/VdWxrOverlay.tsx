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
import { EfisSide } from '@flybywiresim/fbw-sdk';

export interface VdWxrOverlayProps {
  side: EfisSide;
  wxrVisible: Subscribable<boolean>;
  centerLat: Subscribable<number>;
  centerLong: Subscribable<number>;
  range: Subscribable<number>;
}

export class VdWxrOverlay extends DisplayComponent<VdWxrOverlayProps> {
  private readonly imgRef = FSComponent.createRef<HTMLImageElement>();

  private readonly wrapperStyle = Subject.create('display: none;');

  private mapListener: ViewListener.ViewListener;

  private uid = 0;

  private isBound = false;

  private isListenerRegistered = false;

  private isDestroyed = false;

  private isWxrOn = false;

  private lastSrc = '';

  private pos = new LatLong(0, 0);

  private radius = 100000;

  private readonly w = 540;

  private readonly h = 200;

  private static readonly WXR_CONE = 4 * Math.PI;

  private static readonly DEFAULT_WXR_COLORS: [number, number][] = [
    [0x00000000, 0.5],
    [0xFF00FF04, 2.75],
    [0xFF00FBFF, 12.5],
    [0xFF0000FF, 12.5],
  ];

  onAfterRender(node: VNode): void {
    super.onAfterRender(node);

    this.registerListener();
    window.addEventListener('OnDestroy', this.destroy.bind(this));

    this.props.wxrVisible.sub((v) => {
      if (v) {
        this.wake();
      } else {
        this.sleep();
      }
    });

    this.props.centerLat.sub(() => this.updatePositionRadius());
    this.props.centerLong.sub(() => this.updatePositionRadius());
    this.props.range.sub(() => this.updatePositionRadius());
  }

  private registerListener(): void {
    if (this.isListenerRegistered) return;
    this.mapListener = RegisterViewListener('JS_LISTENER_MAPS', this.onListenerRegistered.bind(this));
  }

  private onListenerRegistered(): void {
    if (this.isDestroyed || this.isListenerRegistered) return;
    this.mapListener.on('MapBinded', this.onListenerBound.bind(this));
    this.mapListener.on('MapUpdated', this.onMapUpdate.bind(this));
    this.isListenerRegistered = true;
    this.mapListener.trigger('JS_BIND_BINGMAP', `a380x_vd_wxr_${this.props.side}`, 0);
  }

  private onListenerBound(binder: { friendlyName: string; is3D: boolean }, uid: number): void {
    if (this.isDestroyed || binder.friendlyName !== `a380x_vd_wxr_${this.props.side}`) return;
    this.uid = uid;
    this.isBound = true;

    const colors = VdWxrOverlay.DEFAULT_WXR_COLORS;
    const colorArray = colors.map((c) => c[0]);
    const rateArray = colors.map((c) => c[1]);

    Coherent.call('SET_MAP_CLEAR_COLOR', this.uid, 0x00000000);
    Coherent.call('SET_MAP_HEIGHT_COLORS', this.uid, [0x00000000, 0x00000000]);
    Coherent.call('SET_MAP_RESOLUTION', this.uid, this.w, this.h);
    Coherent.call('SET_MAP_WEATHER_RADAR_COLORS', this.uid, colorArray, rateArray);
    Coherent.call('SET_MAP_WEATHER_RADAR_PBH', this.uid, 0, 0, 0);
    Coherent.call('SET_MAP_ALTITUDE_RANGE', this.uid, 0, 60000);
    this.updatePositionRadius();

    if (this.props.wxrVisible.get()) {
      this.wake();
    }
  }

  private onMapUpdate(uid: number, imgSrc: string): void {
    if (this.isDestroyed || uid !== this.uid) return;
    if (imgSrc === this.lastSrc) return;
    this.lastSrc = imgSrc;
    if (this.imgRef.instance) {
      this.imgRef.instance.src = imgSrc;
    }
  }

  private wake(): void {
    if (this.isWxrOn || !this.isBound) return;
    this.isWxrOn = true;
    this.lastSrc = '';
    this.wrapperStyle.set('display: block;');
    Coherent.call('SHOW_MAP', this.uid, true);
    Coherent.call('SHOW_MAP_WEATHER', this.uid, EWeatherRadar.VERTICAL, VdWxrOverlay.WXR_CONE);
    this.updatePositionRadius();
  }

  private sleep(): void {
    if (!this.isWxrOn) return;
    this.isWxrOn = false;
    this.lastSrc = '';
    this.wrapperStyle.set('display: none;');
    if (this.imgRef.instance) {
      this.imgRef.instance.src = '';
    }
    if (this.isBound) {
      Coherent.call('SHOW_MAP', this.uid, false);
    }
  }

  private updatePositionRadius(): void {
    const lat = this.props.centerLat.get();
    const long = this.props.centerLong.get();
    if (!Number.isFinite(lat) || !Number.isFinite(long)) return;

    this.pos = new LatLong(lat, long);
    const rangeNm = this.props.range.get();
    if (!Number.isFinite(rangeNm) || rangeNm <= 0) return;

    const radius = rangeNm * 1852;
    this.radius = radius;

    if (this.isBound) {
      Coherent.call('SET_MAP_PARAMS', this.uid, this.pos, this.radius);
      Coherent.call('SET_MAP_ALTITUDE_RANGE', this.uid, 0, 60000);
    }
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.sleep();
    this.mapListener?.off('MapBinded', this.onListenerBound.bind(this));
    this.mapListener?.off('MapUpdated', this.onMapUpdate.bind(this));
    window.removeEventListener('OnDestroy', this.destroy.bind(this));
  }

  render(): VNode | null {
    return (
      <div style={this.wrapperStyle}>
        <img
          ref={this.imgRef}
          style={`width: ${this.w}px; height: 400px; position: absolute; top: -100px; mix-blend-mode: screen;`}
        />
      </div>
    );
  }
}
