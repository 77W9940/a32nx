//  Copyright (c) 2026 FlyByWire Simulations
//  SPDX-License-Identifier: GPL-3.0
import { Atc } from '@datalink/atc';
import { Aoc } from '@datalink/aoc';
import { SimVarHandling } from '@datalink/common';
import { Router, VhfRadioInterface } from '@datalink/router';
import { EventBus, EventSubscriber, Instrument, SimVarValueType } from '@microsoft/msfs-sdk';
import { PowerSupplyBusTypes } from '../Misc/powersupply';
import { FrequencyMode, RegisteredSimVar } from '@flybywiresim/fbw-sdk';
import { AtsuFmsClient } from './AtsuFmsClient';

class A380xVhfProvider implements VhfRadioInterface {
  private static readonly RmpModeActive3 = RegisteredSimVar.create<number>(
    'L:FBW_RMP_MODE_ACTIVE_3',
    SimVarValueType.Enum,
  );

  public isDataModeActive(): boolean {
    return A380xVhfProvider.RmpModeActive3.get() === FrequencyMode.Data;
  }
}
export class AtsuSystem implements Instrument {
  private readonly simVarHandling: SimVarHandling;

  //FIXME: This should be in NSS? Not CPIOM D.
  private readonly powerSupply: EventSubscriber<PowerSupplyBusTypes>;

  private readonly atc: Atc;

  private readonly aoc: Aoc;

  private readonly router: Router;

  private readonly atsuFmsClient: AtsuFmsClient;

  constructor(private readonly bus: EventBus) {
    this.simVarHandling = new SimVarHandling(this.bus);
    this.router = new Router(this.bus, false, false, new A380xVhfProvider());
    this.atc = new Atc(this.bus, false, false);
    this.aoc = new Aoc(this.bus, false);
    this.atsuFmsClient = new AtsuFmsClient(this.bus);

    this.powerSupply = this.bus.getSubscriber<PowerSupplyBusTypes>();
    this.powerSupply.on('acBus1').handle((powered: boolean) => {
      //FIXME: Should be NSS status
      if (powered) {
        this.router.powerUp();
        this.atc.powerUp();
        this.aoc.powerUp();
      } else {
        this.aoc.powerDown();
        this.atc.powerDown();
        this.router.powerDown();
      }
    });
  }

  public init(): void {
    this.simVarHandling.initialize();
    this.simVarHandling.startPublish();
    this.router.initialize();
    this.atc.initialize();
    this.aoc.initialize();
    this.atsuFmsClient.init();
  }

  public onUpdate(): void {
    this.simVarHandling.update();
    this.router.update();
  }
}
