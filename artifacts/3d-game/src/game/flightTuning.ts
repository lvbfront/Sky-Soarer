// Every tunable number of the flight model in one place: turning, the springs that smooth it, the
// air brake, the steering settings' ranges and the chase camera. Plain numbers only (no three.js,
// no DOM), so the "How to fly" guide and the landing page can quote them without loading the
// engine, and the pure flight model (flightModel.ts) and its tests read exactly what the engine
// flies with. Angles are written in degrees and converted once; speeds are world units (meters)
// per second; times are seconds.
//
// Why these numbers: see the "Flight physics" section of CLAUDE.md, and the PR that introduced
// this module (it measured the old model: 29°/s at full input in every medium but water, 14°/s
// underwater, so a U-turn took 6–13 s).

const DEG = Math.PI / 180;

// ---- Speeds -----------------------------------------------------------------------------------
// Cruise and boost airspeed live in presets.ts (BASE_SPEED 9, BOOST_SPEED 20) because the guide and
// the landing quote them; the swimming speeds are here.
export const UNDERWATER_BASE_SPEED = 5;
export const UNDERWATER_BOOST_SPEED = 10;

// ---- Turn model -------------------------------------------------------------------------------
//
// A coordinated turn: the yaw rate grows with tan(bank) and falls with speed. Pure 1/speed (what a
// real glider does) gives 40°/s when boosting and 180°/s when braking, far from the feel we want
// (60°/s and 140°/s), so the speed term is softened to 1/√(speed / TURN_REF_SPEED). With one gain
// that one curve lands every target within a few percent:
//
//   cruise   9 m/s  →  93°/s      boost  20 m/s  →  62°/s      air brake  4.5 m/s  → 132°/s × 1.1 = 145°/s
//   swim     5 m/s  → 125°/s      swim + brake 3 m/s → 161°/s
//
// (all at full input, default sensitivity, after the ramp). Cruise is 93°/s rather than a round 90
// because the ramp (key 0.2 s, bank spring, yaw spring) costs ~0.3 s: a held key turns 180° in
// ~2.2 s and a full circle in ~4.1 s.

/** Bank (degrees) the turn model treats as full input; tan(58°) ≈ 1.6. */
export const TURN_BANK_MAX_DEG = 58;
export const TURN_BANK_MAX = TURN_BANK_MAX_DEG * DEG;
/** Speed the turn gain is quoted at: cruise. */
export const TURN_REF_SPEED = 9;
/** Full-input yaw rate at TURN_REF_SPEED, degrees per second. */
export const CRUISE_TURN_RATE_DEG = 93;
/** Below this speed the turn rate stops growing (a hovering bird doesn't spin on the spot). */
export const TURN_MIN_SPEED = 2.5;
/** Extra turn authority while the air brake is held in the air (wings cupped, nose into the turn). */
export const AIR_BRAKE_TURN_FACTOR = 1.1;
/** Same, swimming (the slower speed already tightens the turn enough). */
export const WATER_BRAKE_TURN_FACTOR = 1;
/** Hard ceiling on the yaw rate, any medium or setting. */
export const MAX_YAW_RATE_DEG = 200;

// ---- Smoothing (critically damped springs, ζ = 1) -----------------------------------------------
//
// A spring's "response time" here is when it has covered 63% of a step: for a critically damped
// spring that's ω·t ≈ 2.146, so ω = 2.146 / response.
export const SPRING_63 = 2.146;
/** Bank (the smoothed roll input) response. */
export const BANK_RESPONSE = 0.15;
/** Yaw-rate response to the bank (on top of the bank's own). */
export const YAW_RATE_RESPONSE = 0.06;
/** Yaw angular acceleration cap, so turns ease in and out (degrees per second²). */
export const MAX_YAW_ACCEL_DEG = 400;
/** Pitch (the smoothed pitch input) response. */
export const PITCH_RESPONSE = 0.2;

// ---- Attitude -----------------------------------------------------------------------------------
/** Pitch angle at full climb/dive input (default sensitivity). */
export const MAX_PITCH_DEG = 38;
/** Visual bank at full input, default sensitivity: flying, and swimming (less bank, more body yaw). */
export const VISUAL_BANK_AIR_DEG = 60;
export const VISUAL_BANK_WATER_DEG = 40;
/** The visual bank never exceeds this, whatever the sensitivity. */
export const VISUAL_BANK_LIMIT_DEG = 70;
/** Swimming: the body yaws into the turn by yawRate × this (seconds), capped. Flying: a little. */
export const BODY_YAW_LEAD_WATER = 0.16;
export const BODY_YAW_LEAD_AIR = 0.04;
export const BODY_YAW_MAX_DEG = 22;

// ---- Steering settings (both control modes) ----------------------------------------------------
//
// Sensitivity (0.5x – 2.0x) is turn authority: it scales tan(bank), so the turn rate, by
// √sensitivity (0.71x – 1.41x: 66°/s – 132°/s at cruise), the visual bank with it, the pitch range
// by sensitivity^¼, and how fast the keyboard ramps to full input (also √sensitivity). Invert pitch
// flips climb and dive for both inputs.
export const MIN_SENSITIVITY = 0.5;
export const MAX_SENSITIVITY = 2.0;
export const DEFAULT_SENSITIVITY = 1;

// ---- Keyboard ramps (axis units per second, at default sensitivity) -----------------------------
/** Bank: full deflection in 1 / 5 = 0.2 s, rolling out in ~0.17 s, reversing in ~0.22 s. */
export const KEY_ROLL_RAMP_UP = 5;
export const KEY_ROLL_RAMP_DOWN = 6;
export const KEY_ROLL_REVERSE = 9;
/** Pitch keeps the older, gentler ramp: ~0.36 s to full climb or dive. */
export const KEY_PITCH_RAMP_UP = 2.8;
export const KEY_PITCH_RAMP_DOWN = 4;
export const KEY_PITCH_REVERSE = 6;

// ---- Hand comfort -------------------------------------------------------------------------------
/**
 * Expo on the box-normalized palm offset (after the deadzone): out = (1 − e)·v + e·v³. Small offsets
 * turn gently; with the tan(bank) of the turn model the last 30% of travel gives more than half of
 * the full turn rate (70% of travel: ~38°/s, full: 93°/s).
 */
export const HAND_EXPO = 0.35;

// ---- Air brake ----------------------------------------------------------------------------------
/** Target speed while braking, as a fraction of cruise (flying and swimming). */
export const AIR_BRAKE_SPEED_FRACTION = 0.5;
export const WATER_BRAKE_SPEED_FRACTION = 0.6;
/** Never slower than this in the air: the brake can't stall the bird. */
export const MIN_FLYING_SPEED = 4;
/** Gentle sink while braking in the air (m/s), which makes landing approaches natural. */
export const AIR_BRAKE_SINK = 1.5;
/** How fast speed eases toward the brake target (per second), and how fast the brake blends in/out. */
export const BRAKE_SPEED_RATE = 3.2;
export const BRAKE_BLEND_RATE = 8;
/** The wind's intensity dips by this fraction at full brake. */
export const BRAKE_WIND_DIP = 0.35;

// ---- Chase camera -------------------------------------------------------------------------------
export const CAMERA_DISTANCE = 6.5;
export const CAMERA_HEIGHT = 2.2;
/** Closer underwater, where the fog is thick. */
export const CAMERA_DISTANCE_WATER = 5;
export const CAMERA_HEIGHT_WATER = 1.7;
/** Boost pulls the camera back by this much per m/s above cruise (the old positional lag did). */
export const CAMERA_SPEED_PULLBACK = 0.3;
/** Camera yaw follows the heading with a critically damped spring of this response. */
export const CAMERA_YAW_RESPONSE = 0.3;
export const CAMERA_PITCH_RESPONSE = 0.35;
export const CAMERA_DISTANCE_RESPONSE = 0.45;
/** Look-into-turn lead: the camera aims ahead by yawRate × this (seconds). Reduced motion: less. */
export const CAMERA_LEAD = 0.18;
export const CAMERA_LEAD_REDUCED = 0.08;
/** The camera never trails the heading by more than this, so the bird stays in frame. */
export const CAMERA_MAX_ANGLE_DEG = 35;
/** Camera roll as a fraction of the bird's visual bank (none under reduced motion). */
export const CAMERA_ROLL_FRACTION = 0.22;
/** FOV widens by up to this many degrees in the tightest turns (none under reduced motion). */
export const CAMERA_TURN_FOV_DEG = 3;
export const LOOK_AHEAD_DISTANCE = 8;
/** The camera stays this far above the ground on the mountain map and over islands. */
export const CAMERA_GROUND_CLEARANCE = 0.8;

export const deg = (degrees: number) => degrees * DEG;

