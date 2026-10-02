//! Staff: personas, roles, seniority, traits, schedules and the per-person
//! state machine.
//!
//! FSM (driven by [`crate::world::World::step`]):
//!
//! ```text
//! OffSite ──arrive──► Arriving(path) ──► Working (seated at home desk)
//!    ▲                                    │  ▲
//!    │                    standup 09:00   ▼  │ 09:20
//!    │                     WalkingToMeeting ─► InMeeting ─► ReturningToDesk
//!    │                                    │  ▲
//!    │                       lunch break  ▼  │
//!    │                      WalkingToLunch ─► Lunch (kitchen, or at the desk)
//!    │                                    │
//!    └────────── OffSite ◄── Leaving(path) ◄── leave time / fired
//! ```
//!
//! A person only re-decides while standing still; a walk always finishes
//! first. Decisions are pure functions of the clock, the person's jittered
//! schedule for today and company policy.

use std::collections::BTreeMap;

use rand_core::RngCore;
use serde::{Deserialize, Serialize};

use crate::clock::hm;
use crate::geom::PosMm;
use crate::ids::{EquipId, MeetingId, PersonaId, ProjectId, RoomId, StaffId};
use crate::pathfinding::Path;

/// Permille stat, 0..=1000.
pub type Permille = u16;

/// Base walking speed in millimetres per step (2.0 m/s real time). Brisk on
/// purpose: at the default 20-minute day, crossing a 20 m office takes about
/// ten game minutes.
pub const BASE_WALK_MM_PER_STEP: i32 = 200;
/// Maximum minutes of daily jitter applied to arrival and leave times.
pub const SCHEDULE_JITTER_MINUTES: u16 = 10;
/// Latest anyone stays (also caps jitter).
pub const LATEST_LEAVE: u16 = hm(23, 50);
/// Seat offsets around a room centre for meetings and the kitchen table (mm).
/// Small rooms use only the first seats (a table seats at most the room's
/// capacity), and every offset is clamped to the room interior
/// ([`crate::world::World::spot_pos`]).
pub const ROUND_TABLE_SEATS: [(i32, i32); 12] = [
    (-1200, 0),
    (1200, 0),
    (0, -1000),
    (0, 1000),
    (-900, -800),
    (900, -800),
    (-900, 800),
    (900, 800),
    (-2100, 0),
    (2100, 0),
    (0, -1900),
    (0, 1900),
];

pub use crate::personas::{persona, persona_by_key, persona_slug, Persona, PERSONAS};
pub use crate::roles::{Department, Role};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Seniority {
    Junior,
    Mid,
    Senior,
    Star,
}

impl Seniority {
    /// Base daily salary, cents.
    pub const fn base_salary(self) -> i64 {
        match self {
            Seniority::Junior => 16_000,
            Seniority::Mid => 24_000,
            Seniority::Senior => 34_000,
            Seniority::Star => 56_000,
        }
    }

    /// Claude model a job for this person runs on when sent to the Agency
    /// (plan §A: seniority picks the model).
    pub const fn model_hint(self) -> &'static str {
        match self {
            Seniority::Junior => "claude-haiku-4-5",
            Seniority::Mid => "claude-sonnet-5-5",
            Seniority::Senior | Seniority::Star => "claude-opus-5-5",
        }
    }

    /// The next step up, if any.
    pub const fn promoted(self) -> Option<Seniority> {
        match self {
            Seniority::Junior => Some(Seniority::Mid),
            Seniority::Mid => Some(Seniority::Senior),
            Seniority::Senior => Some(Seniority::Star),
            Seniority::Star => None,
        }
    }

    pub const fn slug(self) -> &'static str {
        match self {
            Seniority::Junior => "junior",
            Seniority::Mid => "mid",
            Seniority::Senior => "senior",
            Seniority::Star => "star",
        }
    }
}

/// Daily salary for a role and seniority, cents.
pub const fn salary_for(role: Role, seniority: Seniority) -> i64 {
    seniority.base_salary() * role.pay_factor() / 1000
}

/// Personality, permille each. Drive sim speed/error rates and render into
/// the persona's work-style prompt paragraph.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Traits {
    pub rigor: Permille,
    pub speed: Permille,
    pub creativity: Permille,
    pub sociability: Permille,
    pub resilience: Permille,
    pub ambition: Permille,
}

impl Traits {
    pub const fn even(v: Permille) -> Traits {
        Traits {
            rigor: v,
            speed: v,
            creativity: v,
            sociability: v,
            resilience: v,
            ambition: v,
        }
    }

    pub fn roll(rng: &mut impl RngCore) -> Traits {
        let mut r = || 200 + (rng.next_u32() % 701) as u16;
        Traits {
            rigor: r(),
            speed: r(),
            creativity: r(),
            sociability: r(),
            resilience: r(),
            ambition: r(),
        }
    }

    /// Walking speed derived from the speed trait (200..=300 mm/step).
    pub fn walk_speed(&self) -> i32 {
        BASE_WALK_MM_PER_STEP + i32::from(self.speed.min(1000)) / 10
    }
}

/// A day's working hours, minutes of day.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schedule {
    pub arrive: u16,
    pub leave: u16,
    pub lunch: u16,
}

impl Schedule {
    pub const fn new(arrive: u16, leave: u16, lunch: u16) -> Schedule {
        Schedule {
            arrive,
            leave,
            lunch,
        }
    }

    /// Today's schedule: the base with seeded jitter (±10 min arrive/leave,
    /// 0..15 min lunch).
    pub fn jittered(&self, rng: &mut impl RngCore) -> Schedule {
        let span = u32::from(SCHEDULE_JITTER_MINUTES) * 2 + 1;
        let j = |rng: &mut dyn RngCore| -> i32 {
            i32::try_from(rng.next_u32() % span).unwrap_or(0) - i32::from(SCHEDULE_JITTER_MINUTES)
        };
        let shift = |m: u16, d: i32, lo: u16, hi: u16| -> u16 {
            let v = (i32::from(m) + d).clamp(i32::from(lo), i32::from(hi));
            u16::try_from(v).unwrap_or(lo)
        };
        let arrive = shift(self.arrive, j(rng), hm(5, 0), hm(12, 0));
        let leave = shift(self.leave, j(rng), arrive + 60, LATEST_LEAVE);
        let lunch_shift = i32::try_from(rng.next_u32() % 16).unwrap_or(0);
        let lunch = shift(self.lunch, lunch_shift, hm(11, 0), hm(15, 0));
        Schedule {
            arrive,
            leave,
            lunch,
        }
    }
}

/// A place a person can be at (or be walking to).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Spot {
    /// The chair at a desk.
    Desk(EquipId),
    /// A seat at a meeting's table.
    MeetingSeat { meeting: MeetingId, seat: u8 },
    /// A seat at the kitchen table.
    KitchenSeat { room: RoomId, seat: u8 },
}

/// Where a person is in their day.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Activity {
    OffSite,
    /// Walking in from the street.
    Arriving,
    /// Seated at the home desk.
    Working,
    WalkingToMeeting,
    InMeeting,
    WalkingToLunch,
    /// On lunch break (kitchen, or at the desk when there is no kitchen).
    Lunch,
    ReturningToDesk,
    /// Walking out to the street.
    Leaving,
}

impl Activity {
    pub const fn slug(self) -> &'static str {
        match self {
            Activity::OffSite => "off-site",
            Activity::Arriving => "arriving",
            Activity::Working => "working",
            Activity::WalkingToMeeting => "walking-to-meeting",
            Activity::InMeeting => "in-meeting",
            Activity::WalkingToLunch => "walking-to-lunch",
            Activity::Lunch => "lunch",
            Activity::ReturningToDesk => "returning-to-desk",
            Activity::Leaving => "leaving",
        }
    }

    /// Counts as working time for fatigue.
    pub const fn is_work(self) -> bool {
        matches!(self, Activity::Working | Activity::InMeeting)
    }
}

/// Body pose the renderer animates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Pose {
    Walk,
    Sit,
    Type,
    Talk,
    Listen,
    Idle,
}

impl Pose {
    pub const fn slug(self) -> &'static str {
        match self {
            Pose::Walk => "walk",
            Pose::Sit => "sit",
            Pose::Type => "type",
            Pose::Talk => "talk",
            Pose::Listen => "listen",
            Pose::Idle => "idle",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Staff {
    pub id: StaffId,
    pub persona: PersonaId,
    pub role: Role,
    pub seniority: Seniority,
    pub traits: Traits,
    pub morale: Permille,
    pub fatigue: Permille,
    /// Daily salary, cents.
    pub salary: i64,
    pub home_desk: Option<EquipId>,
    /// Usual hours.
    pub base_schedule: Schedule,
    /// Today's hours (base + seeded jitter, re-rolled at 00:00).
    pub today: Schedule,
    pub activity: Activity,
    /// Where the person is, or where the current walk leads.
    pub spot: Option<Spot>,
    pub pos: PosMm,
    pub path: Option<Path>,
    /// Minutes on site after 18:00 today (paid 1.5× at settlement).
    pub overtime_minutes: u32,
    /// Fired: walks out and is removed once off site.
    pub leaving_for_good: bool,
    /// Project allocations in percent (ADR-0029). Sum is at most 100;
    /// unallocated capacity is overhead ("house work").
    pub projects: BTreeMap<ProjectId, u8>,
}

impl Staff {
    /// Total allocation across projects, percent.
    pub fn allocated_pct(&self) -> u16 {
        self.projects.values().map(|p| u16::from(*p)).sum()
    }

    /// Allocation on one project, percent (0 when not on the team).
    pub fn allocation(&self, project: ProjectId) -> u8 {
        self.projects.get(&project).copied().unwrap_or(0)
    }

    pub fn department(&self) -> Department {
        self.role.department()
    }

    /// Employed and not on the way out.
    pub fn is_active(&self) -> bool {
        !self.leaving_for_good
    }

    pub fn is_on_site(&self) -> bool {
        self.activity != Activity::OffSite
    }

    /// The desk this person is sitting at right now.
    pub fn seated_at(&self) -> Option<EquipId> {
        match (self.spot, &self.path) {
            (Some(Spot::Desk(d)), None) if self.is_on_site() => Some(d),
            _ => None,
        }
    }
}

/// Someone on today's hiring shortlist.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Candidate {
    pub id: crate::ids::CandidateId,
    pub persona: PersonaId,
    pub role: Role,
    pub seniority: Seniority,
    pub traits: Traits,
    /// Daily salary asked, cents.
    pub salary: i64,
}

impl Candidate {
    /// One-off signing fee: one day's salary.
    pub fn signing_fee(&self) -> i64 {
        self.salary
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_pcg::Pcg32;

    #[test]
    fn jitter_is_bounded_and_seeded() {
        let base = Schedule::new(hm(9, 0), hm(18, 0), hm(12, 30));
        let mut a = Pcg32::new(1, 2);
        let mut b = Pcg32::new(1, 2);
        for _ in 0..200 {
            let s = base.jittered(&mut a);
            assert_eq!(s, base.jittered(&mut b));
            assert!(s.arrive.abs_diff(base.arrive) <= SCHEDULE_JITTER_MINUTES);
            assert!(s.leave.abs_diff(base.leave) <= SCHEDULE_JITTER_MINUTES);
            assert!(s.lunch >= base.lunch && s.lunch <= base.lunch + 15);
        }
    }

    #[test]
    fn late_schedule_is_capped() {
        let base = Schedule::new(hm(8, 0), hm(23, 45), hm(12, 30));
        let mut rng = Pcg32::new(9, 9);
        for _ in 0..100 {
            assert!(base.jittered(&mut rng).leave <= LATEST_LEAVE);
        }
    }

    #[test]
    fn personas_and_salaries() {
        assert_eq!(persona_by_key("marco"), Some(PersonaId(5)));
        assert_eq!(persona(PersonaId(5)).unwrap().name, "Marco");
        assert!(persona(PersonaId(999)).is_none());
        assert_eq!(salary_for(Role::Editor, Seniority::Senior), 39_100);
        assert_eq!(Seniority::Senior.promoted(), Some(Seniority::Star));
        assert_eq!(Seniority::Star.promoted(), None);
    }

    #[test]
    fn traits_drive_speed() {
        assert_eq!(Traits::even(0).walk_speed(), 200);
        assert_eq!(Traits::even(1000).walk_speed(), 300);
    }
}
