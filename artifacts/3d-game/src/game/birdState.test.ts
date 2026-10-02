import { describe, expect, it } from 'vitest';
import { BirdStateMachine, flareDuration, takeoffDuration, type BirdEvent, type BirdStepInput } from './birdState';
import { FLARE_MAX_DURATION, FLARE_MIN_DURATION, TAKEOFF_DURATION, TOUCHDOWN_DURATION } from './flightTuning';

const DT = 1 / 60;
const idle = (): BirdStepInput => ({
  brake: false,
  boost: false,
  takeoffHold: false,
  envelopeOk: false,
  approachOk: true,
  agl: 3,
  surface: 'ground',
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

  it('on the ground a boost tap alone does not take off (Part C makes it a jump)', () => {
    const machine = landed();
    expect(run(machine, 0.2, { boost: true })).toEqual([]);
    expect(machine.mode).toBe('GROUNDED');
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
});
