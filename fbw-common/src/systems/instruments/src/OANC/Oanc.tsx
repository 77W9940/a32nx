// Copyright (c) 2023-2024 FlyByWire Simulations
// SPDX-License-Identifier: GPL-3.0

import {
  ArrayUtils,
  ComponentProps,
  ConsumerSubject,
  DebounceTimer,
  DisplayComponent,
  EventBus,
  FSComponent,
  MappedSubject,
  SimVarValueType,
  Subject,
  Subscribable,
  SubscribableArrayEventType,
  VNode,
  Wait,
} from '@microsoft/msfs-sdk';

import {
  AmdbFeature,
  AmdbFeatureCollection,
  AmdbFeatureTypeStrings,
  AmdbProjection,
  AmdbProperties,
  Arinc429LocalVarConsumerSubject,
  EfisNdMode,
  EfisSide,
  FcuSimVars,
  FeatureType,
  FeatureTypeString,
  FmsOansData,
  GenericAdirsEvents,
  MapParameters,
  MathUtils,
  OansControlEvents,
  OansFmsDataStore,
  OansMapProjection,
  PolygonalStructureType,
} from '@flybywiresim/fbw-sdk';

import {
  bbox,
  bboxPolygon,
  booleanPointInPolygon,
  centroid,
  featureCollection,
  polygon,
  simplify,
  union,
} from '@turf/turf';
import { Feature, FeatureCollection, Geometry, LineString, Point, Polygon, MultiPolygon, Position } from 'geojson';
import { bearingTo, clampAngle, Coordinates, distanceTo } from 'msfs-geo';

import { reciprocal } from '@fmgc/guidance/lnav/CommonGeometry';
import { OansBrakeToVacateSelection } from './OansBrakeToVacateSelection';
import { LAYER_SPECIFICATIONS } from './style-data';
import { OancStaticCanvasLayer } from './OancStaticCanvasLayer';
import { OancBtvCanvasLayer } from './OancBtvCanvasLayer';
import { OancMovingModeOverlay, OancStaticModeOverlay } from './OancMovingModeOverlay';
import { OancAircraftIcon } from './OancAircraftIcon';
import { OancLabelManager } from './OancLabelManager';
import { OancPositionComputer } from './OancPositionComputer';
import { OancMarkerManager } from './OancMarkerManager';
import { ResetPanelSimvars } from './ResetPanelPublisher';
import { NavigraphAmdbClient } from './api/NavigraphAmdbClient';
import { LubberLine } from '../ND/pages/arc/LubberLine';

export const OANC_RENDER_WIDTH = 768;
export const OANC_RENDER_HEIGHT = 768;

export const ZOOM_TRANSITION_TIME_MS = 300;

const PAN_MIN_MOVEMENT = 10;

const LABEL_FEATURE_TYPES = [
  FeatureType.TaxiwayElement,
  FeatureType.VerticalPolygonalStructure,
  FeatureType.PaintedCenterline,
  FeatureType.ParkingStandLocation,
  FeatureType.RunwayExitLine,
];

const LABEL_POLYGON_STRUCTURE_TYPES = [PolygonalStructureType.TerminalBuilding];

export type A320EfisZoomRangeValue = 0.2 | 0.5 | 1 | 2.5;

export type A380EfisZoomRangeValue = 0.2 | 0.5 | 1 | 2 | 5;

export const a320EfisZoomRangeSettings: A320EfisZoomRangeValue[] = [0.2, 0.5, 1, 2.5];

export const a380EfisZoomRangeSettings: A380EfisZoomRangeValue[] = [0.2, 0.5, 1, 2, 5];

const DEFAULT_SCALE_NM = 0.539957;

export const LABEL_VISIBILITY_RULES = [true, true, true, true, true];

export enum LabelStyle {
  Taxiway = 'taxiway',
  ExitLine = 'exit-line',
  TerminalBuilding = 'terminal-building',
  RunwayAxis = 'runway-axis',
  RunwayEnd = 'runway-end',
  FmsSelectedRunwayEnd = 'runway-end-fms-selected',
  FmsSelectedRunwayAxis = 'runway-axis-fms-selected',
  BtvSelectedRunwayEnd = 'runway-end-btv-selected',
  BtvSelectedRunwayArrow = 'runway-arrow-btv-selected',
  BtvSelectedExit = 'exit-line-btv-selected',
  BtvStopLineMagenta = 'btv-stop-line-magenta',
  BtvStopLineAmber = 'btv-stop-line-amber',
  BtvStopLineRed = 'btv-stop-line-red',
  BtvStopLineGreen = 'btv-stop-line-green',
  CrossSymbol = 'cross-symbol',
  FlagSymbol = 'flag-symbol',
}

export interface Label {
  text: string;
  style: LabelStyle;
  position: Position;
  rotation: number | undefined;
  associatedFeature?: AmdbFeature;
}

export interface ContextMenuItemData {
  name: string;

  disabled?: boolean | Subscribable<boolean>;

  onPressed?: () => void;
}

export interface OancProps<T extends number> extends ComponentProps {
  bus: EventBus;
  side: EfisSide;
  contextMenuVisible?: Subject<boolean>;
  contextMenuX?: Subject<number>;
  contextMenuY?: Subject<number>;
  contextMenuItems?: ContextMenuItemData[];
  zoomValues: T[];
}

export class Oanc<T extends number> extends DisplayComponent<OancProps<T>> {
  private readonly sub = this.props.bus.getSubscriber<
    FcuSimVars & OansControlEvents & FmsOansData & GenericAdirsEvents
  >();

  private readonly animationContainerRef = [
    FSComponent.createRef<HTMLDivElement>(),
    FSComponent.createRef<HTMLDivElement>(),
  ];

  private readonly panContainerRef = [FSComponent.createRef<HTMLDivElement>(), FSComponent.createRef<HTMLDivElement>()];

  private readonly staticCanvasLayerRef = FSComponent.createRef<OancStaticCanvasLayer>();

  /**
   * TODO(Task 5): BTV still draws via its old local-meters + context-translate math (OansBrakeToVacateSelection.ts),
   * which is not yet updated to draw through Oanc.projectPoint(). Until that lands, BTV's dynamic overlay (stop
   * lines, runway-ahead markers) will not render correctly on this canvas.
   */
  private readonly btvCanvasLayerRef = FSComponent.createRef<OancBtvCanvasLayer>();

  public labelContainerRef = FSComponent.createRef<HTMLDivElement>();

  public data: AmdbFeatureCollection | undefined;

  private arpCoordinates = Subject.create<Coordinates | null>(null);

  private readonly dataAirportName = Subject.create('');

  private readonly dataAirportIcao = Subject.create('');

  private readonly dataAirportIata = Subject.create('');

  private readonly positionString = Subject.create('');

  private readonly positionVisible = Subject.create(false);

  private readonly airportInfoLine1 = this.dataAirportName.map((it) => it.toUpperCase());

  private readonly airportInfoLine2 = MappedSubject.create(
    ([icao, iata]) => `${icao}  ${iata}`,
    this.dataAirportIcao,
    this.dataAirportIata,
  );

  private readonly resetPulled = ConsumerSubject.create(
    this.props.bus.getSubscriber<ResetPanelSimvars>().on('a380x_reset_panel_arpt_nav'),
    false,
  );

  private layerFeatures: FeatureCollection<Geometry, AmdbProperties>[] = [
    featureCollection([]), // Layer 0: TAXIWAY BG + TAXIWAY SHOULDER
    featureCollection([]), // Layer 1: APRON + STAND BG + BUILDINGS (terminal only)
    featureCollection([]), // Layer 2: RUNWAY (with markings)
    featureCollection([]), // Layer 3: TAXIWAY GUIDANCE LINES (unscaled width)
    featureCollection([]), // Layer 4: TAXIWAY GUIDANCE LINES (scaled width), HOLD SHORT LINES
  ];

  public readonly amdbClient = new NavigraphAmdbClient();

  private readonly labelManager = new OancLabelManager<T>(this);

  private readonly positionComputer = new OancPositionComputer<T>(this);

  public dataLoading = false;

  public doneDrawing = false;

  private isPanningArmed = false;

  public isPanning = false;

  private lastPanX = 0;

  private lastPanY = 0;

  public panArmedX = Subject.create(0);

  public panArmedY = Subject.create(0);

  public panOffsetX = Subject.create(0);

  public panOffsetY = Subject.create(0);

  public panBeingAnimated = Subject.create(false);

  // eslint-disable-next-line arrow-body-style
  private readonly isMapPanned = MappedSubject.create(
    ([panX, panY, panBeingAnimated]) => {
      return panX !== 0 || panY !== 0 || panBeingAnimated;
    },
    this.panOffsetX,
    this.panOffsetY,
    this.panBeingAnimated,
  );

  public modeAnimationOffsetX = Subject.create(0);

  public modeAnimationOffsetY = Subject.create(0);

  private modeAnimationMapNorthUp = Subject.create(false);

  // TODO: Should be using GPS position interpolated with IRS velocity data
  private readonly pposLatWord = Arinc429LocalVarConsumerSubject.create(this.sub.on('latitude'));
  private readonly pposLongWord = Arinc429LocalVarConsumerSubject.create(this.sub.on('longitude'));
  private readonly trueHeadingWord = Arinc429LocalVarConsumerSubject.create(this.sub.on('trueHeadingRaw'));

  public readonly ppos = MappedSubject.create(
    ([latWord, longWord]) => ({ lat: latWord.value, long: longWord.value }) as Coordinates,
    this.pposLatWord,
    this.pposLongWord,
  );

  public referencePos: Coordinates = { lat: 0, long: 0 };

  public readonly aircraftWithinAirport = Subject.create(false);

  private readonly airportWithinRange = Subject.create(false);

  private readonly airportTooFarAwayAndInArcNavMode = Subject.create(false);

  private readonly airportBearing = Subject.create(0);

  public readonly projectedPpos = MappedSubject.create<[Coordinates, Coordinates | null], Position>(
    ([ppos, arpCoordinates], previous?: Position | undefined) => {
      if (arpCoordinates) {
        return OansMapProjection.globalToAirportCoordinates(arpCoordinates, ppos, [0, 0]);
      }

      return previous ?? [0, 0];
    },
    this.ppos,
    this.arpCoordinates,
  );

  private readonly aircraftOnGround = Subject.create(true);

  private readonly mapHeading = Subject.create(0);

  public readonly interpolatedMapHeading = Subject.create(0);

  public readonly previousZoomLevelIndex: Subject<number> = Subject.create(this.props.zoomValues.length - 1);

  public readonly zoomLevelIndex: Subject<number> = Subject.create(this.props.zoomValues.length - 1);

  public readonly arpReferencedMapParams = new MapParameters();

  private readonly oansVisible = ConsumerSubject.create<{ side: EfisSide; show: boolean }>(null, {
    side: this.props.side,
    show: false,
  });

  private readonly efisNDModeSub = ConsumerSubject.create<EfisNdMode>(null, EfisNdMode.PLAN);

  private readonly efisOansRangeSub = ConsumerSubject.create<number>(null, 4);

  private readonly overlayNDModeSub = Subject.create(EfisNdMode.PLAN);

  private readonly ndModeSwitchDelayDebouncer = new DebounceTimer();

  private readonly fmsDataStore = new OansFmsDataStore(this.props.bus);

  // TODO(Task 5): canvasRef/canvasCentreX/canvasCentreY intentionally omitted - BTV's draw methods no-op via their
  // existing `!this.canvasRef?.getOrDefault()` guards until they're updated to draw through btvCanvasLayerRef's own
  // projection instead of local-meters + context-translate.
  private readonly btvUtils = new OansBrakeToVacateSelection<T>(
    this.props.bus,
    this.labelManager,
    this.aircraftOnGround,
    this.projectedPpos,
    this.arpCoordinates,
    undefined,
    undefined,
    undefined,
    this.zoomLevelIndex,
    this.getZoomLevelInverseScale.bind(this),
  );

  private readonly markerManager = new OancMarkerManager<T>(this, this.labelManager, this.props.bus);

  private readonly airportNotInActiveFpln = MappedSubject.create(
    ([ndMode, arpt, origin, dest, altn]) => ndMode !== EfisNdMode.ARC && ![origin, dest, altn].includes(arpt),
    this.overlayNDModeSub,
    this.dataAirportIcao,
    this.fmsDataStore.origin,
    this.fmsDataStore.destination,
    this.fmsDataStore.alternate,
  );

  private readonly pposNotAvailable = MappedSubject.create(
    ([lat, long, trueHeading]) =>
      !lat.isNormalOperation() || !long.isNormalOperation() || !trueHeading.isNormalOperation(),
    this.pposLatWord,
    this.pposLongWord,
    this.trueHeadingWord,
  );

  // eslint-disable-next-line arrow-body-style
  public usingPposAsReference = MappedSubject.create(
    ([overlayNDMode, aircraftOnGround, aircraftWithinAirport]) => {
      return (aircraftOnGround && aircraftWithinAirport) || overlayNDMode === EfisNdMode.ARC;
    },
    this.overlayNDModeSub,
    this.aircraftOnGround,
    this.aircraftWithinAirport,
  );

  // eslint-disable-next-line arrow-body-style
  private readonly showAircraft = MappedSubject.create(
    ([icao, pposRef]) => icao !== '' && pposRef,
    this.dataAirportIcao,
    this.usingPposAsReference,
  );

  private readonly aircraftX = Subject.create(0);

  private readonly aircraftY = Subject.create(0);

  private readonly aircraftRotation = Subject.create(0);

  private readonly zoomLevelScales: number[] = this.props.zoomValues.map((it) => 1 / ((it * 2) / DEFAULT_SCALE_NM));

  private readonly airportLoading = Subject.create(false);

  private readonly arptNavPosLostFlagVisible = MappedSubject.create(
    ([pposNotAvailable, efisNDModeSub]) => pposNotAvailable && efisNDModeSub !== EfisNdMode.PLAN,
    this.pposNotAvailable,
    this.overlayNDModeSub,
  );

  private readonly pleaseWaitFlagVisible = MappedSubject.create(
    ([arptNavPosLostFlagVisible, airportLoading]) => !arptNavPosLostFlagVisible && airportLoading,
    this.arptNavPosLostFlagVisible,
    this.airportLoading,
  );

  private readonly oansNotAvailable = ConsumerSubject.create(null, false);

  private readonly anyFlagVisible = MappedSubject.create(
    ([arptNavPosLostFlagVisible, pleaseWaitFlagVisible]) => arptNavPosLostFlagVisible || pleaseWaitFlagVisible,
    this.arptNavPosLostFlagVisible,
    this.pleaseWaitFlagVisible,
  );

  private readonly oansPerformanceModeHide = Subject.create(false);

  public getZoomLevelInverseScale() {
    const multiplier = this.overlayNDModeSub.get() === EfisNdMode.ROSE_NAV ? 0.5 : 1;

    return this.zoomLevelScales[this.zoomLevelIndex.get()] * multiplier;
  }

  onAfterRender(node: VNode) {
    super.onAfterRender(node);

    this.labelContainerRef.instance.addEventListener('mousedown', this.handleCursorPanStart.bind(this));
    this.labelContainerRef.instance.addEventListener('mousemove', this.handleCursorPanMove.bind(this));
    this.labelContainerRef.instance.addEventListener('mouseup', this.handleCursorPanStop.bind(this));

    this.oansVisible.setConsumer(this.sub.on('nd_show_oans'));
    this.oansNotAvailable.setConsumer(this.sub.on('oans_not_avail'));
    this.efisNDModeSub.setConsumer(this.sub.on('ndMode'));

    this.efisNDModeSub.sub((mode) => {
      this.handleNDModeChange(mode);
      this.handleLabelFilter();
    }, true);

    this.efisOansRangeSub.setConsumer(this.sub.on('oansRange'));

    this.efisOansRangeSub.sub((range) => this.zoomLevelIndex.set(range), true);

    this.airportTooFarAwayAndInArcNavMode.sub((v) =>
      this.props.bus.getPublisher<OansControlEvents>().pub('oans_show_set_plan_mode', v, true),
    );

    this.sub
      .on('oans_display_airport')
      .whenChanged()
      .handle((airport) => {
        if (this.oansPerformanceModeHide.get()) {
          this.dataAirportIcao.set(airport);
        } else {
          this.loadAirportMap(airport);
        }
      });

    this.sub
      .on('oans_performance_mode_hide')
      .whenChanged()
      .handle((perfHide) => {
        if (this.props.side === perfHide.side) {
          this.oansPerformanceModeHide.set(perfHide.hide);
        }
      });

    this.oansPerformanceModeHide.sub((hide) => {
      if (hide) {
        this.unloadAirportMap(true);
      } else if (this.dataAirportIcao.get()) {
        this.loadAirportMap(this.dataAirportIcao.get(), true);
      }
    });

    this.sub.on('oans_center_on_acft').handle(() => this.centerOnAcft());
    this.sub.on('oans_center_map_on').handle((coords) => this.centerMapOn(coords));
    this.sub.on('oans_add_cross_at_feature').handle((f) => this.markerManager.addCrossAtFeature(f.id, f.feattype));
    this.sub.on('oans_add_flag_at_feature').handle((f) => this.markerManager.addFlagAtFeature(f.id, f.feattype));
    this.sub
      .on('oans_remove_cross_at_feature')
      .handle((f) => this.markerManager.removeCrossAtFeature(f.id, f.feattype));
    this.sub.on('oans_remove_flag_at_feature').handle((f) => this.markerManager.removeFlagAtFeature(f.id, f.feattype));
    this.sub
      .on('oans_add_cross_at_cursor')
      .handle(([x, y]) => this.markerManager.addCross(this.unprojectPoint([x, y])));
    this.sub.on('oans_add_flag_at_cursor').handle(([x, y]) => this.markerManager.addFlag(this.unprojectPoint([x, y])));
    this.sub.on('oans_erase_all_crosses').handle(() => this.markerManager.eraseAllCrosses());
    this.sub.on('oans_erase_all_flags').handle(() => this.markerManager.eraseAllFlags());
    this.sub.on('oans_erase_cross_id').handle((id) => this.markerManager.removeCross(id));
    this.sub.on('oans_erase_flag_id').handle((id) => this.markerManager.removeFlag(id));
    this.sub.on('oans_query_symbols_at_cursor').handle((data) => {
      const foundSymbols = this.markerManager.findSymbolAtCursor(this.unprojectPoint(data.cursorPosition));
      this.props.bus.getPublisher<OansControlEvents>().pub('oans_answer_symbols_at_cursor', {
        side: data.side,
        cross: foundSymbols.cross,
        flag: foundSymbols.flag,
      });
    });
    this.sub
      .on('oans_remove_btv_data')
      .whenChanged()
      .handle((removeBtvData) => {
        if (removeBtvData) {
          this.btvUtils.clearSelection();
        }
      });

    this.fmsDataStore.origin.sub(() => this.updateLabelClasses());
    this.fmsDataStore.departureRunway.sub(() => this.updateLabelClasses());
    this.fmsDataStore.destination.sub(() => this.updateLabelClasses());
    this.fmsDataStore.landingRunway.sub(() => this.updateLabelClasses());
    this.btvUtils.btvRunway.sub(() => this.updateLabelClasses());
    this.btvUtils.btvExit.sub(() => {
      this.updateLabelClasses();
    });

    this.labelManager.visibleLabels.sub((_index, type, item) => {
      switch (type) {
        case SubscribableArrayEventType.Added: {
          if (Array.isArray(item)) {
            for (const label of item as Label[]) {
              const element = this.createLabelElement(label);

              this.labelContainerRef.instance.appendChild(element);
              this.labelManager.visibleLabelElements.set(label, element);
            }
          } else {
            const element = this.createLabelElement(item as Label);

            this.labelContainerRef.instance.appendChild(element);
            this.labelManager.visibleLabelElements.set(item as Label, element);
          }
          break;
        }
        case SubscribableArrayEventType.Removed: {
          if (Array.isArray(item)) {
            for (const label of item as Label[]) {
              const element = this.labelManager.visibleLabelElements.get(label);
              if (element) {
                this.labelContainerRef.instance.removeChild(element);
                this.labelManager.visibleLabelElements.delete(label);
              }
            }
          } else {
            const element = this.labelManager.visibleLabelElements.get(item as Label);
            if (element) {
              this.labelContainerRef.instance.removeChild(element);
              this.labelManager.visibleLabelElements.delete(item as Label);
            }
          }
          break;
        }
        default:
          break;
      }
    });

    this.zoomLevelIndex.sub(() => this.handleLabelFilter(), true);

    // Only write the (cheap, GPU-composited) pan transform here. Update() already calls reflowLabels()
    // unconditionally every frame regardless of panning, so calling it again here too was pure redundant DOM work
    // on every single raw mousemove tick during a drag (which fires far faster than the frame rate) - that's what
    // was causing pan stutter.
    MappedSubject.create(this.panOffsetX, this.panOffsetY).sub(([x, y]) => {
      this.panContainerRef[0].instance.style.transform = `translate(${x}px, ${y}px)`;
      this.panContainerRef[1].instance.style.transform = `translate(${x}px, ${y}px)`;
    });

    MappedSubject.create(
      ([x, y]) => {
        this.animationContainerRef[0].instance.style.transform = `translate(${x}px, ${y}px)`;
        this.animationContainerRef[1].instance.style.transform = `translate(${x}px, ${y}px)`;
      },
      this.modeAnimationOffsetX,
      this.modeAnimationOffsetY,
    );

    this.pposNotAvailable.sub((notAvailable) => {
      SimVar.SetSimVarValue('L:A32NX_ARPT_NAV_POS_LOST', SimVarValueType.Bool, notAvailable);
    }, true);
  }

  private handleLabelFilter() {
    this.labelManager.showLabels = false;

    if (this.efisNDModeSub.get() === EfisNdMode.ARC) {
      switch (this.zoomLevelIndex.get()) {
        case 4:
        case 3:
          this.labelManager.currentFilter = { type: 'none' };
          break;
        case 2:
          this.labelManager.currentFilter = { type: 'major' };
          break;
        default:
          this.labelManager.currentFilter = { type: 'null' };
          break;
      }
    } else {
      switch (this.zoomLevelIndex.get()) {
        case 0:
          this.labelManager.currentFilter = { type: 'runwayBtvSelection', runwayIdent: null, showAdjacent: true };
          break;
        default:
          this.labelManager.currentFilter = { type: 'runwayBtvSelection', runwayIdent: null, showAdjacent: false };
          break;
      }
    }

    setTimeout(() => (this.labelManager.showLabels = true), ZOOM_TRANSITION_TIME_MS + 200);
  }

  public unloadAirportMap(performanceModeUnload: boolean = false) {
    if (!performanceModeUnload) {
      this.btvUtils.clearSelection();
    }
    this.markerManager.eraseAllCrosses();
    this.markerManager.eraseAllFlags();
    this.clearMap();
    this.clearData();

    this.arpCoordinates.set(null);
    this.data = undefined;
    this.aircraftWithinAirport.set(false);

    this.btvUtils.transmitRwyAheadAdvisory(false, '', true);
  }

  /**
   *
   * @param icao four letter ICAO code of airport to load
   * @returns
   */
  public async loadAirportMap(icao: string, performanceModeUnload: boolean = false) {
    this.dataLoading = true;
    this.airportLoading.set(true);

    this.unloadAirportMap(performanceModeUnload);

    if (!icao) {
      this.dataLoading = false;
      this.airportLoading.set(false);

      this.dataAirportName.set('');
      this.dataAirportIcao.set('');
      this.dataAirportIata.set('');

      return;
    }

    const includeFeatureTypes: FeatureType[] = Object.values(LAYER_SPECIFICATIONS).reduce(
      (acc, it) => [
        ...acc,
        ...it.styleRules.reduce(
          (acc, it) => [
            ...acc,
            ...(it?.dontFetchFromAmdb || it.forFeatureTypes === undefined ? [] : it.forFeatureTypes),
          ],
          [] as FeatureType[],
        ),
      ],
      [] as FeatureType[],
    );
    const includeLayers = includeFeatureTypes.map((it) => AmdbFeatureTypeStrings[it]);

    // Additional stuff we need that isn't handled by the canvas renderer
    includeLayers.push(FeatureTypeString.AerodromeReferencePoint);
    includeLayers.push(FeatureTypeString.ParkingStandLocation);
    includeLayers.push(FeatureTypeString.PaintedCenterline);
    includeLayers.push(FeatureTypeString.RunwayThreshold);

    const data = await this.amdbClient.getAirportData(icao, includeLayers, undefined);
    const wgs84ArpDat = await this.amdbClient.getAirportData(
      icao,
      [FeatureTypeString.AerodromeReferencePoint],
      undefined,
      AmdbProjection.Epsg4326,
    );

    const features = Object.values(data).reduce((acc, it) => {
      const features = it.features.map((f) => {
        // FeatureCollection
        if (f.properties.idthr || f.properties.idrwy) {
          const nf = Object.assign({}, f);
          if (nf.properties.idthr && nf.properties.idthr.replace(/[^0-9]/g, '').length < 2) {
            nf.properties.idthr = `0${nf.properties.idthr}`;
          }

          if (nf.properties.idrwy) {
            nf.properties.idrwy = nf.properties.idrwy
              .split('.')
              .map((qfu) => (qfu.replace(/[^0-9]/g, '').length < 2 ? `0${qfu}` : qfu))
              .join('.');
          }

          return nf;
        }
        return f;
      });

      return [...acc, ...features];
    }, [] as AmdbFeature[]);
    const airportMap: AmdbFeatureCollection = featureCollection(features);

    const wgs84ReferencePoint = wgs84ArpDat.aerodromereferencepoint?.features[0];

    if (!wgs84ReferencePoint) {
      console.error('[OANC](loadAirportMap) Invalid airport data - aerodrome reference point not found');
      return;
    }

    const refPointLat = (wgs84ReferencePoint.geometry as Point).coordinates[1];
    const refPointLong = (wgs84ReferencePoint.geometry as Point).coordinates[0];
    const projectionScale = 1000;

    if (!refPointLat || !refPointLong || !projectionScale) {
      console.error(
        '[OANC](loadAirportMap) Invalid airport data - aerodrome reference point does not contain lat/long/scale custom properties',
      );
      return;
    }
    this.arpCoordinates.set({ lat: refPointLat, long: refPointLong });

    this.data = airportMap;

    if (wgs84ReferencePoint) {
      this.dataAirportName.set(wgs84ReferencePoint?.properties?.name ?? '');
      this.dataAirportIcao.set(icao);
      this.dataAirportIata.set(wgs84ReferencePoint?.properties?.iata ?? '');
    }

    // Figure out the boundaries of the map data
    const dataBbox = bbox(airportMap);

    if (!this.pposNotAvailable.get()) {
      this.aircraftWithinAirport.set(booleanPointInPolygon(this.projectedPpos.get(), bboxPolygon(dataBbox)));
    } else {
      this.aircraftWithinAirport.set(false);
    }

    this.sortDataIntoLayers(this.data);
    this.generateAllLabels(this.data);

    const staticCanvasLayer = this.staticCanvasLayerRef.getOrDefault();
    staticCanvasLayer?.setAirportData(this.arpCoordinates.get() !== null, this.layerFeatures, this.dataAirportIcao.get());
    // Belt-and-suspenders: setAirportData() already triggers a redraw whenever the airport ICAO key changes, but
    // loadAirportMap() can be reached via several different event-driven paths (oans_display_airport,
    // oansPerformanceModeHide toggling, manual reload), and this is the one place all of them funnel through once
    // loading actually completes - force a redraw here too so a race in the key-comparison logic can never leave a
    // stale drawing on screen.
    staticCanvasLayer?.requestRedraw();

    this.dataLoading = false;
  }

  private createLabelElement(label: Label): HTMLDivElement {
    const element = document.createElement('div');

    element.classList.add('oanc-label');
    element.classList.add(`oanc-label-style-${label.style}`);
    element.textContent = label.text;

    if (label.style === LabelStyle.RunwayEnd) {
      element.addEventListener('click', () => {
        const thresholdFeature = this.data?.features.filter(
          (it) => it.properties.feattype === FeatureType.RunwayThreshold && it.properties?.idthr === label.text,
        );
        if (thresholdFeature && label.associatedFeature) {
          this.btvUtils.selectRunwayFromOans(
            `${this.dataAirportIcao.get()}${label.text}`,
            label.associatedFeature,
            thresholdFeature[0],
          );
        }
      });
    }
    if (
      label.style === LabelStyle.ExitLine &&
      label.associatedFeature?.properties.feattype === FeatureType.RunwayExitLine
    ) {
      element.addEventListener('click', () => {
        if (label.associatedFeature) {
          this.btvUtils.selectExitFromOans(label.text, label.associatedFeature);
        }
      });
    }

    return element;
  }

  private sortDataIntoLayers(data: AmdbFeatureCollection) {
    for (let i = 0; i < this.layerFeatures.length; i++) {
      const layer = this.layerFeatures[i];
      const layerSpec = LAYER_SPECIFICATIONS[i];

      if (layerSpec.styleRules.length === 0) {
        continue;
      }

      const featuresByStyleRule: AmdbFeature[][] = [];

      for (const styleRule of layerSpec.styleRules) {
        const matchingFeatures = data.features.filter(
          (it) =>
            (styleRule.forFeatureTypes === undefined || styleRule.forFeatureTypes.includes(it.properties.feattype)) &&
            (it.properties.plysttyp === undefined ||
              it.properties.feattype !== FeatureType.VerticalPolygonalStructure ||
              styleRule.forPolygonStructureTypes === undefined ||
              styleRule.forPolygonStructureTypes.includes(it.properties.plysttyp)),
        );

        unionFeatures: if (styleRule.unionBy !== undefined) {
          const featuresAreAllPolygons = matchingFeatures.every(
            (it) => it.geometry.type === 'Polygon' || it.geometry.type === 'MultiPolygon',
          );

          if (!featuresAreAllPolygons) {
            console.warn(
              '[Oanc](sortDataIntoLayers) Style rule had unionBy declared but not all filtered features were (multi)polygons. Not unioning them.',
            );
            break unionFeatures;
          }

          const finalFeatures: AmdbFeature<Polygon | MultiPolygon>[] = [];
          const groups = new Map<AmdbProperties[keyof AmdbProperties], AmdbFeature<Polygon | MultiPolygon>[]>();

          for (const feature of matchingFeatures) {
            const key = styleRule.unionBy !== 'all' ? feature.properties[styleRule.unionBy] : 'all';
            let existingGroup = groups.get(key);

            if (existingGroup === undefined) {
              existingGroup = [];
              groups.set(key, existingGroup);
            }

            if (styleRule.simplify !== undefined) {
              existingGroup.push(
                simplify(feature, { tolerance: styleRule.simplify }) as AmdbFeature<Polygon | MultiPolygon>,
              );
            } else {
              existingGroup.push(feature as AmdbFeature<Polygon | MultiPolygon>);
            }
          }

          const unionedGroups = Array.from(groups.values()).map((it) =>
            it.length > 1 ? union(featureCollection(it), { properties: it[0].properties }) : it[0],
          );

          for (const unionedGroup of unionedGroups) {
            if (unionedGroup === null) {
              continue;
            }

            switch (unionedGroup.geometry.type) {
              case 'Polygon':
                finalFeatures.push(unionedGroup);
                break;
              case 'MultiPolygon':
                for (const polygonCoordinates of unionedGroup.geometry.coordinates) {
                  const polygonFeature = polygon(polygonCoordinates, unionedGroup.properties);

                  finalFeatures.push(polygonFeature);
                }
            }
          }

          featuresByStyleRule.push(finalFeatures);
        } else {
          featuresByStyleRule.push(matchingFeatures);
        }
      }

      layer.features.push(...ArrayUtils.flat(featuresByStyleRule));
    }
  }

  private generateAllLabels(data: AmdbFeatureCollection) {
    for (const feature of data.features) {
      if (!LABEL_FEATURE_TYPES.includes(feature.properties.feattype)) {
        continue;
      }

      // Only include "Taxiway" features that have a valid "idlin" property
      if (feature.properties.feattype === FeatureType.TaxiwayElement && !feature.properties.idlin) {
        continue;
      }

      // Only include "VerticalPolygonObject" features whose "plysttyp" property has what we want
      if (
        feature.properties.feattype === FeatureType.VerticalPolygonalStructure &&
        feature.properties.plysttyp &&
        !LABEL_POLYGON_STRUCTURE_TYPES.includes(feature.properties.plysttyp)
      ) {
        continue;
      }

      let labelPosition: Position = [0, 0];
      switch (feature.geometry.type) {
        case 'Point': {
          const point = feature.geometry as Point;

          labelPosition = point.coordinates;
          break;
        }
        case 'Polygon': {
          const polygon = feature.geometry as Polygon;

          labelPosition = centroid(polygon).geometry.coordinates;
          break;
        }
        case 'LineString': {
          const lineString = feature.geometry as LineString;

          labelPosition = centroid(lineString).geometry.coordinates;
          break;
        }
        default: {
          console.error(`[OANC] Cannot determine label position for geometry of type '${feature.geometry.type}'`);
        }
      }

      if (feature.properties.feattype === FeatureType.PaintedCenterline) {
        const designators: string[] = [];
        if (feature.properties.idrwy) {
          designators.push(...feature.properties.idrwy.split('.'));
        }

        if (designators.length === 0) {
          console.error(`Runway feature (id=${feature.properties.id}) does not have a valid idrwy value`);
          continue;
        }

        const runwayLine = feature.geometry as LineString;
        const runwayLineStart = runwayLine.coordinates[0];
        const runwayLineEnd = runwayLine.coordinates[runwayLine.coordinates.length - 1];
        const runwayLineBearing = clampAngle(
          -Math.atan2(runwayLineStart[1] - runwayLineEnd[1], runwayLineStart[0] - runwayLineEnd[0]) *
            MathUtils.RADIANS_TO_DEGREES +
            90,
        );

        // If reciprocal bearing doesn't match to rwy designator[0], swap designators
        if (
          Math.abs(Number(designators[0].replace(/\D/g, '')) * 10 - reciprocal(runwayLineBearing)) > 90 &&
          designators.length === 2
        ) {
          const copied = Array.from(designators);
          designators.length = 0;
          designators.push(copied[1], copied[0]);
        }

        const isFmsOrigin = this.dataAirportIcao.get() === this.fmsDataStore.origin.get();
        const isFmsDestination = this.dataAirportIcao.get() === this.fmsDataStore.origin.get();
        const depRwy = this.fmsDataStore.departureRunway.get()?.substring(4);
        const ldgRwy = this.fmsDataStore.landingRunway.get()?.substring(4);
        const isSelectedRunway =
          (isFmsOrigin && depRwy && designators.includes(depRwy)) ||
          (isFmsDestination && ldgRwy && designators.includes(ldgRwy));

        const label1: Label = {
          text: designators[0],
          style:
            this.btvUtils.btvRunway.get() === designators[0] ? LabelStyle.BtvSelectedRunwayEnd : LabelStyle.RunwayEnd,
          position: runwayLineStart,
          rotation: reciprocal(runwayLineBearing),
          associatedFeature: feature,
        };
        this.labelManager.visibleLabels.insert(label1);
        this.labelManager.labels.push(label1);

        // Sometimes, runways have only one designator (e.g. EDDF 18R)
        if (designators[1]) {
          const label2: Label = {
            text: designators[1],
            style:
              this.btvUtils.btvRunway.get() === designators[1] ? LabelStyle.BtvSelectedRunwayEnd : LabelStyle.RunwayEnd,
            position: runwayLineEnd,
            rotation: runwayLineBearing,
            associatedFeature: feature,
          };
          this.labelManager.visibleLabels.insert(label2);
          this.labelManager.labels.push(label2);

          const label3: Label = {
            text: `${designators[0]}-${designators[1]}`,
            style: isSelectedRunway ? LabelStyle.FmsSelectedRunwayAxis : LabelStyle.RunwayAxis,
            position: runwayLineEnd,
            rotation: runwayLineBearing,
            associatedFeature: feature,
          };
          this.labelManager.visibleLabels.insert(label3);
          this.labelManager.labels.push(label3);
        } else {
          const label3: Label = {
            text: designators[0],
            style: isSelectedRunway ? LabelStyle.FmsSelectedRunwayAxis : LabelStyle.RunwayAxis,
            position: runwayLineEnd,
            rotation: runwayLineBearing,
            associatedFeature: feature,
          };
          this.labelManager.visibleLabels.insert(label3);
          this.labelManager.labels.push(label3);
        }

        // Selected FMS runway (origin or destination)
        const labelFms1: Label = {
          text: designators[0],
          style: LabelStyle.FmsSelectedRunwayEnd,
          position: runwayLineStart,
          rotation: reciprocal(runwayLineBearing),
          associatedFeature: feature,
        };
        this.labelManager.labels.push(labelFms1);
        this.labelManager.visibleLabels.insert(labelFms1);

        const labelFms2: Label = {
          text: designators[1],
          style: LabelStyle.FmsSelectedRunwayEnd,
          position: runwayLineEnd,
          rotation: runwayLineBearing,
          associatedFeature: feature,
        };
        this.labelManager.labels.push(labelFms2);
        this.labelManager.visibleLabels.insert(labelFms2);

        // BTV selected runway
        const btvSelectedArrow1: Label = {
          text: designators[0],
          style: LabelStyle.BtvSelectedRunwayArrow,
          position: runwayLineStart,
          rotation: reciprocal(runwayLineBearing),
          associatedFeature: feature,
        };
        this.labelManager.labels.push(btvSelectedArrow1);
        this.labelManager.visibleLabels.insert(btvSelectedArrow1);

        const btvSelectedArrow2: Label = {
          text: designators[1],
          style: LabelStyle.BtvSelectedRunwayArrow,
          position: runwayLineEnd,
          rotation: runwayLineBearing,
          associatedFeature: feature,
        };
        this.labelManager.labels.push(btvSelectedArrow2);
        this.labelManager.visibleLabels.insert(btvSelectedArrow2);
      } else {
        const text = feature.properties.idlin ?? feature.properties.idstd ?? feature.properties.ident ?? undefined;

        if (
          feature.properties.feattype === FeatureType.ParkingStandLocation &&
          text !== undefined &&
          text.includes('_')
        ) {
          continue;
        }

        if (text !== undefined) {
          let style: LabelStyle.TerminalBuilding | LabelStyle.Taxiway | LabelStyle.ExitLine;
          switch (feature.properties.feattype) {
            case FeatureType.VerticalPolygonalStructure:
              style = LabelStyle.TerminalBuilding;
              break;
            case FeatureType.ParkingStandLocation:
              style = LabelStyle.TerminalBuilding;
              break;
            case FeatureType.RunwayExitLine:
              style = LabelStyle.ExitLine;
              break;
            default:
              style = LabelStyle.Taxiway;
              break;
          }

          const existing = this.labelManager.labels.filter((it) => it.text === text);

          const shortestDistance = existing.reduce((shortestDistance, label) => {
            const distance = MathUtils.pointDistance(
              label.position[0],
              label.position[1],
              labelPosition[0],
              labelPosition[1],
            );

            return distance > shortestDistance ? distance : shortestDistance;
          }, Number.MAX_SAFE_INTEGER);

          if (
            (feature.properties.feattype === FeatureType.ParkingStandLocation &&
              existing.some((it) => feature.properties.termref === it.associatedFeature?.properties.termref)) ||
            shortestDistance < 50
          ) {
            continue;
          }

          const label = {
            text: text.toUpperCase(),
            style,
            position: labelPosition,
            rotation: undefined,
            associatedFeature: feature,
          };

          this.labelManager.labels.push(label);
          this.labelManager.visibleLabels.insert(label);
        }
      }
    }
  }

  private lastTime = 0;

  public Update() {
    const now = Date.now();
    const deltaTime = (now - this.lastTime) / 1_000;
    this.lastTime = now;

    if (this.data && this.resetPulled.get()) {
      this.unloadAirportMap(true);
    }

    if (!this.data || this.dataLoading || this.resetPulled.get()) {
      return;
    }

    this.aircraftOnGround.set(
      // FIXME use an enum...
      ![6, 7, 8, 9].includes(SimVar.GetSimVarValue('L:A32NX_FWC_FLIGHT_PHASE', SimVarValueType.Number)),
    );

    const arpCoordinates = this.arpCoordinates.get();
    if (!this.pposNotAvailable.get() && arpCoordinates) {
      this.aircraftWithinAirport.set(booleanPointInPolygon(this.projectedPpos.get(), bboxPolygon(bbox(this.data))));

      const distToArpt = this.arpCoordinates.get() ? distanceTo(this.ppos.get(), arpCoordinates) : 9999;

      // If in ARC mode and airport more than 30nm away, apply a hack to not create a huge canvas (only shift airport a little bit out of view with a static offset)
      this.airportTooFarAwayAndInArcNavMode.set(
        !this.pposNotAvailable.get() && this.usingPposAsReference.get() && distToArpt > 30,
      );

      if (this.arpCoordinates.get()) {
        this.airportWithinRange.set(distToArpt < this.props.zoomValues[this.zoomLevelIndex.get()] + 3); // Add 3nm for airport dimension, FIXME better estimation
        this.airportBearing.set(bearingTo(this.ppos.get(), arpCoordinates));
      } else {
        this.airportWithinRange.set(true);
        this.airportBearing.set(0);
      }
    } else {
      this.airportTooFarAwayAndInArcNavMode.set(false);
      this.aircraftWithinAirport.set(false);
      this.airportWithinRange.set(true);
    }

    if (this.usingPposAsReference.get() || !arpCoordinates) {
      this.referencePos = this.ppos.get();
    } else {
      this.referencePos = arpCoordinates;
    }

    if (!this.pposNotAvailable.get() && arpCoordinates) {
      const position = this.positionComputer.computePosition();

      if (position) {
        this.positionVisible.set(true);
        this.positionString.set(position);
      } else {
        this.positionVisible.set(false);
      }

      this.btvUtils.updateRwyAheadAdvisory(
        this.ppos.get(),
        arpCoordinates,
        this.trueHeadingWord.get().value,
        this.layerFeatures[2],
      );
    } else {
      this.positionVisible.set(false);
    }

    // If OANS is not visible on this side (i.e. range selector is not on ZOOM), don't continue here to save runtime
    if (this.oansVisible.get().side === this.props.side && !this.oansVisible.get().show) {
      return;
    }

    const mapTargetHeading = this.modeAnimationMapNorthUp.get() ? 0 : this.trueHeadingWord.get().value;
    this.mapHeading.set(mapTargetHeading);

    const interpolatedMapHeading = this.interpolatedMapHeading.get();

    if (Math.abs(mapTargetHeading - interpolatedMapHeading) > 0.1) {
      const rotateLeft = MathUtils.diffAngle(interpolatedMapHeading, mapTargetHeading) < 0;

      if (rotateLeft) {
        this.interpolatedMapHeading.set(clampAngle(interpolatedMapHeading - deltaTime * 90));

        if (MathUtils.diffAngle(this.interpolatedMapHeading.get(), mapTargetHeading) > 0) {
          this.interpolatedMapHeading.set(mapTargetHeading);
        }
      } else {
        this.interpolatedMapHeading.set(clampAngle(interpolatedMapHeading + deltaTime * 90));

        if (MathUtils.diffAngle(this.interpolatedMapHeading.get(), mapTargetHeading) < 0) {
          this.interpolatedMapHeading.set(mapTargetHeading);
        }
      }
    }

    const mapCurrentHeading = this.interpolatedMapHeading.get();

    if (arpCoordinates) {
      this.arpReferencedMapParams.compute(arpCoordinates, 0, 0.539957, 1_000, mapCurrentHeading);
    }

    // Transform airplane
    this.aircraftX.set(384);
    this.aircraftY.set(384);
    this.aircraftRotation.set(this.trueHeadingWord.get().value - mapCurrentHeading);

    // Drive the static canvas layer. It's not attached to any framework "map projection changed" listener - we own
    // its update cycle the same way we already own labelManager's, positionComputer's, etc. Heading is NEVER a
    // redraw trigger - see OancStaticCanvasLayer's class doc: the buffer is drawn reference-point-centered, north-up,
    // and heading is applied purely as a CSS transform (translate/rotate/translate, pivoting on the ARP without
    // needing content to be centered there), matching how the SDK's own MapCachedCanvasLayer rotates for free
    // (verified directly in its implementation).
    if (!this.airportTooFarAwayAndInArcNavMode.get()) {
      // projectPoint([0, 0]) is the ARP's own projected screen position this frame - see OancStaticCanvasLayer's
      // class doc for why this is exactly the value needed to track panning between redraws.
      const [arpProjectedX, arpProjectedY] = this.projectPoint([0, 0]);
      const scale = this.getZoomLevelInverseScale();
      // eslint-disable-next-line prefer-const
      let [offsetX, offsetY] = this.arpReferencedMapParams.coordinatesToXYy(this.referencePos);
      offsetY *= -1;

      this.staticCanvasLayerRef.getOrDefault()?.setZoomLevelIndex(this.zoomLevelIndex.get());
      // CSS rotate()'s angle must be the *negative* of the map heading - projectPoint(x, y) rotates a point by
      // +heading (see its own derivation below), while the buffer here is drawn north-up with a Y-flip
      // (rotationAdjustY comes out negated relative to CSS's y-down rotation convention) - working through both
      // rotation matrices shows the two effects combine to a sign flip. Verified algebraically end-to-end: this is
      // the exact angle that reproduces projectPoint()'s rotation via the CSS transform pivoting on the ARP.
      this.staticCanvasLayerRef
        .getOrDefault()
        ?.update(arpProjectedX, arpProjectedY, scale, offsetX, offsetY, -mapCurrentHeading);
    }

    if (!this.doneDrawing) {
      this.doneDrawing = true;
      this.airportLoading.set(false);
    }

    const depRwy = this.fmsDataStore.departureRunway.get();
    const ldgRwy = this.fmsDataStore.landingRunway.get();
    const btvRwy = this.btvUtils.btvRunway.get();
    const btvExit = this.btvUtils.btvExit.get();

    this.labelManager.reflowLabels(
      depRwy !== null ? depRwy : undefined,
      ldgRwy !== null ? ldgRwy : undefined,
      btvRwy !== null ? btvRwy : undefined,
      btvExit !== null ? btvExit : undefined,
    );
  }

  private updateLabelClasses() {
    const btvRwy = this.btvUtils.btvRunway.get();
    const btvExit = this.btvUtils.btvExit.get();
    this.labelManager.updateLabelClasses(
      this.fmsDataStore,
      this.dataAirportIcao.get() === this.fmsDataStore.origin.get(),
      this.dataAirportIcao.get() === this.fmsDataStore.destination.get(),
      btvRwy !== null ? btvRwy : undefined,
      btvExit !== null ? btvExit : undefined,
    );
  }

  private clearData(): void {
    for (const layer of this.layerFeatures) {
      layer.features.length = 0;
    }

    this.labelManager.clearLabels();
    this.markerManager.eraseAllFlags();
    this.markerManager.eraseAllCrosses();
  }

  private clearMap(): void {
    this.doneDrawing = false;

    this.staticCanvasLayerRef.getOrDefault()?.setAirportData(false, this.layerFeatures, null);
    this.staticCanvasLayerRef.getOrDefault()?.requestRedraw();

    this.panOffsetX.set(0);
    this.panOffsetY.set(0);
  }

  public async disablePanningTransitions(): Promise<void> {
    for (const container of this.panContainerRef) {
      container.instance.style.transition = 'reset';
    }

    await Wait.awaitFrames(1);

    this.panBeingAnimated.set(false);
  }

  public async enablePanningTransitions(): Promise<void> {
    for (const container of this.panContainerRef) {
      container.instance.style.transition = `transform ${ZOOM_TRANSITION_TIME_MS}ms linear`;
    }

    await Wait.awaitFrames(1);

    this.panBeingAnimated.set(true);
  }

  private async handleNDModeChange(newMode: EfisNdMode) {
    if (this.panOffsetX.get() !== 0 || this.panOffsetY.get() !== 0) {
      // We need to first animate to the default position
      await this.enablePanningTransitions();

      this.panOffsetX.set(0);
      this.panOffsetY.set(0);
      await Wait.awaitDelay(ZOOM_TRANSITION_TIME_MS);

      await this.disablePanningTransitions();
    }

    switch (newMode) {
      case EfisNdMode.ROSE_NAV:
        this.modeAnimationOffsetX.set(0);
        this.modeAnimationOffsetY.set(0);
        break;
      case EfisNdMode.ARC:
        this.modeAnimationOffsetX.set(0);
        this.modeAnimationOffsetY.set(620 - OANC_RENDER_HEIGHT / 2);
        break;
      case EfisNdMode.PLAN:
        this.modeAnimationOffsetX.set(0);
        this.modeAnimationOffsetY.set(0);
        break;
      default:
      // noop
    }

    this.ndModeSwitchDelayDebouncer.schedule(() => {
      this.overlayNDModeSub.set(newMode);

      switch (newMode) {
        case EfisNdMode.ROSE_NAV:
          this.modeAnimationMapNorthUp.set(false);
          break;
        case EfisNdMode.ARC:
          this.modeAnimationMapNorthUp.set(false);
          break;
        case EfisNdMode.PLAN:
          this.modeAnimationMapNorthUp.set(true);
          break;
        default:
        // noop
      }
    }, ZOOM_TRANSITION_TIME_MS);
  }

  public handleZoomIn(): void {
    if (this.zoomLevelIndex.get() !== 0) {
      this.zoomLevelIndex.set(this.zoomLevelIndex.get() - 1);
    }
  }

  public handleZoomOut(): void {
    if (this.zoomLevelIndex.get() !== this.props.zoomValues.length - 1) {
      this.zoomLevelIndex.set(this.zoomLevelIndex.get() + 1);
    }
  }

  public handleCursorPanStart(event: MouseEvent): void {
    if (this.dataAirportIcao.get()) {
      this.isPanningArmed = true;
      this.panArmedX.set(event.screenX);
      this.panArmedY.set(event.screenY);
    }
  }

  public handleCursorPanMove(event: MouseEvent): void {
    if (this.isPanningArmed) {
      const adx = Math.abs(event.screenX - this.panArmedX.get());
      const ady = Math.abs(event.screenY - this.panArmedY.get());

      // We only actually start panning if we move more than a certain amount - this is to ensure we can differentiate between panning
      // and opening the context menu
      if (adx > PAN_MIN_MOVEMENT || ady > PAN_MIN_MOVEMENT) {
        this.isPanningArmed = false;
        this.isPanning = true;
      }
    }

    if (this.isPanning) {
      this.panOffsetX.set(this.panOffsetX.get() + event.screenX - this.lastPanX);
      this.panOffsetY.set(this.panOffsetY.get() + event.screenY - this.lastPanY);
    }

    this.lastPanX = event.screenX;
    this.lastPanY = event.screenY;
  }

  public handleCursorPanStop(event: MouseEvent): void {
    this.props.contextMenuX?.set(event.screenX);
    this.props.contextMenuY?.set(event.screenY);
    if (!this.isPanning) {
      this.isPanningArmed = false;
      this.props.contextMenuVisible?.set(!this.props.contextMenuVisible.get());
    }
    this.isPanning = false;
  }

  public projectPoint(coordinates: Position): [number, number] {
    const labelX = coordinates[0];
    const labelY = coordinates[1];

    // eslint-disable-next-line prefer-const
    let [offsetX, offsetY] = this.arpReferencedMapParams.coordinatesToXYy(this.referencePos);

    // TODO figure out how to not need this
    offsetY *= -1;

    const mapCurrentHeading = this.interpolatedMapHeading.get();
    const rotate = -mapCurrentHeading;

    const hypotenuse = Math.sqrt(labelX ** 2 + labelY ** 2) * this.getZoomLevelInverseScale();
    const angle = clampAngle(Math.atan2(labelY, labelX) * MathUtils.RADIANS_TO_DEGREES);

    const rotationAdjustX = hypotenuse * Math.cos((angle - rotate) * MathUtils.DEGREES_TO_RADIANS);
    const rotationAdjustY = hypotenuse * Math.sin((angle - rotate) * MathUtils.DEGREES_TO_RADIANS);

    const scaledOffsetX = offsetX * this.getZoomLevelInverseScale();
    const scaledOffsetY = offsetY * this.getZoomLevelInverseScale();

    let labelScreenX = OANC_RENDER_WIDTH / 2 + rotationAdjustX + -scaledOffsetX + this.panOffsetX.get();
    let labelScreenY = OANC_RENDER_HEIGHT / 2 + -rotationAdjustY + scaledOffsetY + this.panOffsetY.get();

    labelScreenX += this.modeAnimationOffsetX.get();
    labelScreenY += this.modeAnimationOffsetY.get();

    return [labelScreenX, labelScreenY];
  }

  public unprojectPoint(screenCoordinates: [number, number]): Position {
    let [labelScreenX, labelScreenY] = screenCoordinates;

    // Undo animation offsets
    labelScreenX -= this.modeAnimationOffsetX.get() + OANC_RENDER_WIDTH / 2 + this.panOffsetX.get();
    labelScreenY -= this.modeAnimationOffsetY.get() + OANC_RENDER_HEIGHT / 2 + this.panOffsetY.get();

    const zoomLevelScale = this.getZoomLevelInverseScale();
    const [offsetX, offsetY] = this.arpReferencedMapParams.coordinatesToXYy(this.referencePos);

    // Undo scaling offsets
    const scaledOffsetX = offsetX * zoomLevelScale;
    const scaledOffsetY = -1 * (offsetY * zoomLevelScale);
    labelScreenX += scaledOffsetX;
    labelScreenY -= scaledOffsetY;

    // Reverse rotation
    const mapCurrentHeading = this.interpolatedMapHeading.get();
    const rotate = -mapCurrentHeading; // Original rotation
    const reverseRotate = -rotate; // Undo rotation

    const hypotenuse = Math.sqrt(labelScreenX ** 2 + labelScreenY ** 2);
    const angle = clampAngle(Math.atan2(-labelScreenY, labelScreenX) * MathUtils.RADIANS_TO_DEGREES);

    const originalX = hypotenuse * Math.cos((angle - reverseRotate) * MathUtils.DEGREES_TO_RADIANS);
    const originalY = hypotenuse * Math.sin((angle - reverseRotate) * MathUtils.DEGREES_TO_RADIANS);

    // Scale back the original position
    const labelX = originalX / zoomLevelScale;
    const labelY = originalY / zoomLevelScale;

    return [labelX, labelY];
  }

  public offsetToPoint(coordinates: Position): [number, number] {
    const projected = this.projectPoint(coordinates);
    const xOffset = -(projected[0] - this.panOffsetX.get() - OANC_RENDER_WIDTH / 2 - this.modeAnimationOffsetX.get());
    const yOffset = -(projected[1] - this.panOffsetY.get() - OANC_RENDER_HEIGHT / 2 - this.modeAnimationOffsetY.get());

    return [xOffset, yOffset];
  }

  async centerOnAcft() {
    await this.enablePanningTransitions();
    this.panOffsetX.set(0);
    this.panOffsetY.set(0);
    await Wait.awaitDelay(ZOOM_TRANSITION_TIME_MS);
    await this.disablePanningTransitions();
  }

  /**
   * Centers map on point supplied in parameters
   * @param x X position in local coordinate system
   * @param y Y position in local coordinate system
   */
  async centerMapOn(pos: Position) {
    const xy = this.offsetToPoint(pos);
    await this.enablePanningTransitions();
    this.panOffsetX.set(xy[0]);
    this.panOffsetY.set(xy[1]);
    await Wait.awaitDelay(ZOOM_TRANSITION_TIME_MS);
    await this.disablePanningTransitions();
  }

  render(): VNode | null {
    return (
      <>
        <div
          class="oanc-flag-container FontSmall"
          style={{ visibility: this.pleaseWaitFlagVisible.map((v) => (v ? 'inherit' : 'hidden')) }}
        >
          PLEASE WAIT
        </div>
        <div
          class="oanc-flag-container amber FontLarge"
          style={{ visibility: this.arptNavPosLostFlagVisible.map((v) => (v ? 'inherit' : 'hidden')) }}
        >
          ARPT NAV POS LOST
        </div>

        <div style={{ display: this.anyFlagVisible.map((v) => (v ? 'none' : 'block')) }}>
          <svg viewBox="0 0 768 768" style="position: absolute;">
            <defs>
              <clipPath id="rose-mode-map-clip">
                <path d="M45,155 L282,155 a250,250 0 0 1 204,0 L723,155 L723,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L45,625 L45,155" />
              </clipPath>
              <clipPath id="rose-mode-wx-terr-clip">
                <path d="M45,155 L282,155 a250,250 0 0 1 204,0 L723,155 L723,384 L45,384 L45,155" />
              </clipPath>
              <clipPath id="rose-mode-tcas-clip">
                <path d="M45,155 L282,155 a250,250 0 0 1 204,0 L723,155 L723,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L45,625 L45,155" />
              </clipPath>
              <clipPath id="arc-mode-map-clip">
                <path d="M0,312 a492,492 0 0 1 768,0 L768,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L0,625 L0,312" />
              </clipPath>
              <clipPath id="arc-mode-wx-terr-clip">
                <path d="M0,312 a492,492 0 0 1 768,0 L768,562 L648,562 L591,625 L0,625 L0,312" />
              </clipPath>
              <clipPath id="arc-mode-tcas-clip">
                <path d="M0,312 a492,492 0 0 1 768,0 L768,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L0,625 L0,312" />
              </clipPath>
              <clipPath id="arc-mode-overlay-clip-4">
                <path d="m 6 0 h 756 v 768 h -756 z" />
              </clipPath>
              <clipPath id="arc-mode-overlay-clip-3">
                <path d="m 0 564 l 384 145 l 384 -145 v -564 h -768 z" />
              </clipPath>
              <clipPath id="arc-mode-overlay-clip-2">
                <path d="m 0 532 l 384 155 l 384 -146 v -512 h -768 z" />
              </clipPath>
              <clipPath id="arc-mode-overlay-clip-1">
                <path d="m 0 519 l 384 145 l 384 -86 v -580 h -768 z" />
              </clipPath>
            </defs>
          </svg>

          {/*
            NOTE: these two are fixed-size (viewport + overdraw margin) plain canvases, replacing the old 5
            airport-bbox-sized canvases - so VRAM cost stays constant regardless of airport size. They manage their
            own CSS transform (panning between redraws) internally, driven from Update() - they are intentionally
            NOT nested inside animationContainerRef[0]/panContainerRef[0] (which would double-apply a transform).
          */}
          <div style="position: absolute;">
            <OancStaticCanvasLayer ref={this.staticCanvasLayerRef} />
            {/* TODO(Task 5): btvCanvasLayerRef is rendered but not yet drawn to - see the btvUtils comment above. */}
            <OancBtvCanvasLayer ref={this.btvCanvasLayerRef} />
          </div>

          <div
            ref={this.animationContainerRef[0]}
            style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear;`}
          >
            <div ref={this.panContainerRef[0]} style="position: absolute;" />
          </div>

          <div
            ref={this.labelContainerRef}
            style={`position: absolute; width: ${OANC_RENDER_WIDTH}px; height: ${OANC_RENDER_HEIGHT}px; pointer-events: auto;`}
          />

          <OancStaticModeOverlay
            bus={this.props.bus}
            oansRange={this.zoomLevelIndex.map((it) => this.props.zoomValues[it])}
            ndMode={this.overlayNDModeSub}
            rotation={this.interpolatedMapHeading}
            isMapPanned={this.isMapPanned}
            airportWithinRange={this.airportWithinRange}
            airportBearing={this.airportBearing}
            airportIcao={this.dataAirportIcao}
          />

          <div
            ref={this.animationContainerRef[1]}
            style={`position: absolute; transition: transform ${ZOOM_TRANSITION_TIME_MS}ms linear; pointer-events: none;`}
          >
            <OancMovingModeOverlay
              bus={this.props.bus}
              oansRange={this.zoomLevelIndex.map((it) => this.props.zoomValues[it])}
              ndMode={this.overlayNDModeSub}
              rotation={this.interpolatedMapHeading}
              isMapPanned={this.isMapPanned}
              airportWithinRange={this.airportWithinRange}
              airportBearing={this.airportBearing}
              airportIcao={this.dataAirportIcao}
            />

            <svg
              class="nd-svg nd-top-layer"
              viewBox="0 0 768 768"
              style={this.efisNDModeSub.map(
                (mode) =>
                  `transform: translateY(${mode === EfisNdMode.ARC ? -236 : 0}px); pointer-events: none; z-index: 99;`,
              )}
            >
              <LubberLine
                bus={this.props.bus}
                visible={MappedSubject.create(
                  ([ac, mode]) => ac && mode !== EfisNdMode.PLAN,
                  this.showAircraft,
                  this.efisNDModeSub,
                )}
                rotation={Subject.create(0)}
                ndMode={this.efisNDModeSub}
                colorClass="Magenta"
              />
            </svg>

            <div ref={this.panContainerRef[1]} style="position: absolute;">
              <OancAircraftIcon
                isVisible={this.showAircraft}
                x={this.aircraftX}
                y={this.aircraftY}
                rotation={this.aircraftRotation}
              />
            </div>
          </div>

          <div
            style={`position: absolute; width: ${OANC_RENDER_WIDTH}px; height: ${OANC_RENDER_HEIGHT}px; pointer-events: none`}
          >
            <div class="oanc-top-mask" />
            <div class="oanc-bottom-mask">
              <span
                class="oanc-position"
                style={{
                  display: this.positionVisible.map((it) => (it ? 'block' : 'none')),
                }}
              >
                {this.positionString}
              </span>

              <span
                class="oanc-bottom-flag FontSmall"
                style={{
                  display: this.pposNotAvailable.map((it) => (it ? 'block' : 'none')),
                }}
              >
                ARPT NAV POS LOST
              </span>
            </div>

            <span class="oanc-airport-info" id="oanc-airport-info-line1">
              {this.airportInfoLine1}
            </span>
            <span class="oanc-airport-info" id="oanc-airport-info-line2">
              {this.airportInfoLine2}
            </span>
            <span
              class="oanc-airport-not-in-active-fpln"
              style={{ display: this.airportNotInActiveFpln.map((it) => (it ? 'inherit' : 'none')) }}
            >
              ARPT NOT IN
              <br />
              ACTIVE F/PLN
            </span>
          </div>
        </div>
      </>
    );
  }
}

