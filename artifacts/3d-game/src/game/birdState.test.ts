import { describe, expect, it } from 'vitest';
import { BirdStateMachine, flareDuration, takeoffDuration, type BirdEvent, type BirdStepInput } from './birdState';
import {
  FLARE_MAX_DURATION,
  FLARE_MIN_DURATION,
  GROUND_FLIP_COOLDOWN,
  TAKEOFF_DURATION,
  TOUCHDOWN_DURATION,
} from './flightTuning';

const DT = 1 / 60;
const idle = (): BirdStepInput => ({
  brake: false,
  boost: false,
  takeoffHold: false,
  envelopeOk: false,
  approachOk: true,
  agl: 3,
  surface: 'ground',
  walk: 0,
  turn: 0,
  backflip: false,
  ground: null,
});

/** Steps for `seconds` with `input`, collecting events. */
function run(machine: BirdStateMachine, seconds: number, input: Partial<BirdStepInput> = {}) {
  const events: BirdEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const event = machine.step(DT, { ...idle(), ...input });
    if (event) events.push(event);
  }
  return events;
}

function landed(surface: 'ground' | 'water' = 'ground') {
  const machine = new BirdStateMachine();
  run(machine, DT, { brake: true, envelopeOk: true, surface, agl: 1 });
  run(machine, FLARE_MAX_DURATION + TOUCHDOWN_DURATION + 0.1, { brake: true, surface });
  return machine;
}

describe('bird state machine', () => {
  it('lands: FLYING → FLARE → TOUCHDOWN → GROUNDED', () => {
    const machine = new BirdStateMachine();
    expect(machine.mode).toBe('FLYING');
    expect(run(machine, DT, { brake: true, envelopeOk: true, agl: 4 })).toEqual(['flare']);
    expect(machine.mode).toBe('FLARE');
    expect(machine.duration).toBeCloseTo(flareDuration(4), 10);
    expect(run(machine, flareDuration(4) + DT, { brake: true })).toEqual(['touchdown']);
    expect(machine.mode).toBe('TOUCHDOWN');
    expect(run(machine, TOUCHDOWN_DURATION + DT)).toEqual(['settled']);
    expect(machine.mode).toBe('GROUNDED');
  });

  it('lands on water into FLOATING', () => {
    expect(landed('water').mode).toBe('FLOATING');
  });

  it('stays FLYING while the envelope fails', () => {
    const machine = new BirdStateMachine();
    expect(run(machine, 3, { brake: true, envelopeOk: false })).toEqual([]);
    expect(machine.mode).toBe('FLYING');
  });

  it('go-around: the approach breaks during the flare → back to FLYING', () => {
    const machine = new BirdStateMachine();
    run(machine, DT, { brake: true, envelopeOk: true, agl: 5 });
    run(machine, 0.3, { brake: true });
    expect(run(machine, DT, { approachOk: false })).toEqual(['go-around']);
    expect(machine.mode).toBe('FLYING');
  });

  it('the flare is never shorter than its minimum, and stretches with height', () => {
    expect(flareDuration(0)).toBe(FLARE_MIN_DURATION);
    expect(flareDuration(5)).toBeGreaterThan(FLARE_MIN_DURATION);
    expect(flareDuration(100)).toBe(FLARE_MAX_DURATION);
  });

  it('hold-to-take-off: GROUNDED → TAKEOFF → FLYING', () => {
    const machine = landed();
    expect(run(machine, 1)).toEqual([]);
    expect(run(machine, DT, { takeoffHold: true })).toEqual(['takeoff']);
    expect(machine.mode).toBe('TAKEOFF');
    expect(machine.surface).toBe('ground');
    expect(run(machine, TAKEOFF_DURATION + DT)).toEqual(['airborne']);
    expect(machine.mode).toBe('FLYING');
  });

  it('from water: a tap of the boost input starts the (longer) takeoff run', () => {
    const machine = landed('water');
    expect(run(machine, DT, { boost: true })).toEqual(['takeoff']);
    expect(machine.surface).toBe('water');
    expect(machine.duration).toBe(takeoffDuration('water'));
    expect(takeoffDuration('water')).toBeGreaterThan(takeoffDuration('ground'));
  });

  it('on the ground a boost tap is a jump, not a takeoff', () => {
    const machine = landed();
    expect(run(machine, DT, { boost: true })).toEqual(['jump']);
    expect(machine.mode).toBe('GROUNDED');
    expect(machine.substate).toBe('JUMP');
  });

  it('blocks the flying tricks and boost in every non-FLYING state', () => {
    const machine = new BirdStateMachine();
    expect(machine.allowsFlightTricks()).toBe(true);
    run(machine, DT, { brake: true, envelopeOk: true, agl: 2 });
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      seen.add(machine.mode);
      if (machine.mode !== 'FLYING') expect(machine.allowsFlightTricks()).toBe(false);
      machine.step(DT, { ...idle(), brake: true, takeoffHold: machine.mode === 'GROUNDED' });
    }
    expect([...seen].sort()).toEqual(['FLARE', 'FLYING', 'GROUNDED', 'TAKEOFF', 'TOUCHDOWN']);
  });

  it('pause/resume: no steps (or zero-length steps) change nothing', () => {
    const machine = landed();
    const before = { mode: machine.mode, time: machine.time };
    for (let i = 0; i < 100; i += 1) expect(machine.step(0, { ...idle(), takeoffHold: true })).toBeNull();
    expect({ mode: machine.mode, time: machine.time }).toEqual(before);
  });

  describe('ground substates (Part C)', () => {
    it('IDLE / WALK / TURN follow the walk and turn inputs', () => {
      const machine = landed();
      expect(machine.substate).toBe('IDLE');
      run(machine, DT, { walk: 0.8 });
      expect(machine.substate).toBe('WALK');
      run(machine, DT, { walk: -0.5, turn: 1 });
      expect(machine.substate).toBe('WALK');
      run(machine, DT, { turn: -1 });
      expect(machine.substate).toBe('TURN');
      run(machine, DT, { walk: 0.02, turn: 0.03 });
      expect(machine.substate).toBe('IDLE');
    });

    it('jump → lands back on its feet', () => {
      const machine = landed();
      run(machine, DT, { boost: true });
      expect(run(machine, 0.5, { boost: false })).toEqual([]);
      expect(machine.substate).toBe('JUMP');
      expect(machine.isJumping()).toBe(true);
      expect(run(machine, DT, { ground: 'landed' })).toEqual(['jump-landed']);
      expect(machine.substate).toBe('IDLE');
    });

    it('jump → jump again while airborne → TAKEOFF from the air (double jump)', () => {
      const machine = landed();
      run(machine, DT, { boost: true });
      run(machine, 0.2, { boost: false });
      expect(run(machine, DT, { boost: true })).toEqual(['takeoff']);
      expect(machine.mode).toBe('TAKEOFF');
      expect(machine.airStart).toBe(true);
      expect(machine.surface).toBe('ground');
    });

    it('holding the jump input 0.4 s (takeoffHold) takes off, from standing or mid-jump', () => {
      const standing = landed();
      expect(run(standing, DT, { takeoffHold: true })).toEqual(['takeoff']);
      expect(standing.airStart).toBe(false);
      const jumping = landed();
      run(jumping, DT, { boost: true });
      expect(run(jumping, DT, { boost: true, takeoffHold: true })).toEqual(['takeoff']);
      expect(jumping.airStart).toBe(true);
    });

    it('a jump that comes down somewhere unstandable flaps off into flight; into water floats', () => {
      const a = landed();
      run(a, DT, { boost: true });
      expect(run(a, DT, { ground: 'landed-unstandable' })).toEqual(['glide']);
      expect(a.mode).toBe('FLYING');
      const b = landed();
      run(b, DT, { boost: true });
      expect(run(b, DT, { ground: 'landed-water' })).toEqual(['enter-water']);
      expect(b.mode).toBe('FLOATING');
    });

    it('ledge → glide into FLYING', () => {
      const machine = landed();
      run(machine, 0.3, { walk: 1 });
      expect(run(machine, DT, { walk: 1, ground: 'ledge' })).toEqual(['glide']);
      expect(machine.mode).toBe('FLYING');
      expect(machine.substate).toBeNull();
    });

    it('beach ↔ water: wading in floats, paddling out stands', () => {
      const machine = landed();
      expect(run(machine, DT, { walk: 1, ground: 'enter-water' })).toEqual(['enter-water']);
      expect(machine.mode).toBe('FLOATING');
      run(machine, DT, { walk: 1 });
      expect(machine.substate).toBe('PADDLE');
      expect(run(machine, DT, { walk: 1, ground: 'exit-water' })).toEqual(['exit-water']);
      expect(machine.mode).toBe('GROUNDED');
    });

    it('ground backflip, at most once per cooldown; no jump or flip on water', () => {
      const machine = landed();
      expect(run(machine, DT, { backflip: true })).toEqual(['ground-flip']);
      expect(machine.substate).toBe('GROUND_FLIP');
      run(machine, DT, { ground: 'landed' });
      // Too soon after the last one.
      expect(run(machine, DT, { backflip: true })).toEqual([]);
      run(machine, GROUND_FLIP_COOLDOWN);
      expect(run(machine, DT, { backflip: true })).toEqual(['ground-flip']);
      // A flip can't be chained into a takeoff by pressing jump mid-flip.
      expect(run(machine, DT, { boost: true })).toEqual([]);
      const floating = landed('water');
      run(floating, DT, { backflip: true });
      expect(floating.mode).toBe('FLOATING');
      expect(floating.substate).not.toBe('GROUND_FLIP');
    });

    it('flying tricks stay blocked in every ground substate', () => {
      const machine = landed();
      for (const input of [{ walk: 1 }, { turn: 1 }, { boost: true }, { backflip: true }] as const) {
        run(machine, DT, input);
        expect(machine.allowsFlightTricks()).toBe(false);
      }
    });
  });
});
