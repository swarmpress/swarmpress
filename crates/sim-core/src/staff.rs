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

use rand_core::RngCore;
use serde::{Deserialize, Serialize};

use crate::clock::hm;
use crate::geom::PosMm;
use crate::ids::{EquipId, MeetingId, PersonaId, RoomId, StaffId};
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
pub const ROUND_TABLE_SEATS: [(i32, i32); 8] = [
    (-1200, 0),
    (1200, 0),
    (0, -1000),
    (0, 1000),
    (-900, -800),
    (900, -800),
    (-900, 800),
    (900, 800),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Role {
    Writer,
    Editor,
    EditorInChief,
    MediaEditor,
    SeoSpecialist,
    Translator,
    ArtDirector,
    FrontendDev,
    QaAnalyst,
    Researcher,
}

impl Role {
    pub const ALL: [Role; 10] = [
        Role::Writer,
        Role::Editor,
        Role::EditorInChief,
        Role::MediaEditor,
        Role::SeoSpecialist,
        Role::Translator,
        Role::ArtDirector,
        Role::FrontendDev,
        Role::QaAnalyst,
        Role::Researcher,
    ];

    /// Salary multiplier, permille.
    pub const fn pay_factor(self) -> i64 {
        match self {
            Role::Writer | Role::MediaEditor | Role::QaAnalyst => 1000,
            Role::Editor => 1150,
            Role::EditorInChief => 1400,
            Role::SeoSpecialist => 1050,
            Role::Translator | Role::Researcher => 950,
            Role::ArtDirector | Role::FrontendDev => 1300,
        }
    }

    /// Default working hours (arrive, leave, lunch).
    pub const fn base_schedule(self) -> Schedule {
        match self {
            Role::Editor | Role::EditorInChief => Schedule::new(hm(8, 30), hm(18, 30), hm(12, 45)),
            Role::FrontendDev | Role::ArtDirector => {
                Schedule::new(hm(9, 30), hm(18, 30), hm(13, 0))
            }
            _ => Schedule::new(hm(9, 0), hm(18, 0), hm(12, 30)),
        }
    }

    pub const fn slug(self) -> &'static str {
        match self {
            Role::Writer => "writer",
            Role::Editor => "editor",
            Role::EditorInChief => "editor-in-chief",
            Role::MediaEditor => "media-editor",
            Role::SeoSpecialist => "seo-specialist",
            Role::Translator => "translator",
            Role::ArtDirector => "art-director",
            Role::FrontendDev => "frontend-dev",
            Role::QaAnalyst => "qa-analyst",
            Role::Researcher => "researcher",
        }
    }
}

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
}

impl Staff {
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

/// A fixed character from the house roster (legacy `agent-personas.ts`) or a
/// generic hire.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Persona {
    pub key: &'static str,
    pub name: &'static str,
    /// sRGB colour, 0xRRGGBB.
    pub color: u32,
    pub role: Role,
    pub specialty: &'static str,
}

/// Persona catalogue. The first six are the legacy cinqueterre.travel staff.
pub const PERSONAS: [Persona; 14] = [
    Persona {
        key: "isabella",
        name: "Isabella",
        color: 0xc0504d,
        role: Role::Writer,
        specialty: "Adventure travel writer",
    },
    Persona {
        key: "lorenzo",
        name: "Lorenzo",
        color: 0x4f81bd,
        role: Role::Writer,
        specialty: "Cultural historian",
    },
    Persona {
        key: "sophia",
        name: "Sophia",
        color: 0x9bbb59,
        role: Role::Writer,
        specialty: "Hospitality and accommodations expert",
    },
    Persona {
        key: "giulia",
        name: "Giulia",
        color: 0x8064a2,
        role: Role::Writer,
        specialty: "Culinary expert and food writer",
    },
    Persona {
        key: "marco",
        name: "Marco",
        color: 0xf79646,
        role: Role::Editor,
        specialty: "Practical information specialist",
    },
    Persona {
        key: "francesca",
        name: "Francesca",
        color: 0x4bacc6,
        role: Role::MediaEditor,
        specialty: "Visual storyteller and photographer",
    },
    Persona {
        key: "alessandro",
        name: "Alessandro",
        color: 0x2c4d75,
        role: Role::SeoSpecialist,
        specialty: "Search and structure",
    },
    Persona {
        key: "chiara",
        name: "Chiara",
        color: 0xd99694,
        role: Role::Translator,
        specialty: "German and French translation",
    },
    Persona {
        key: "matteo",
        name: "Matteo",
        color: 0x77933c,
        role: Role::FrontendDev,
        specialty: "Astro themes and performance",
    },
    Persona {
        key: "elena",
        name: "Elena",
        color: 0x604a7b,
        role: Role::ArtDirector,
        specialty: "Typography and mood boards",
    },
    Persona {
        key: "davide",
        name: "Davide",
        color: 0xb65708,
        role: Role::QaAnalyst,
        specialty: "Fact checking and link hygiene",
    },
    Persona {
        key: "valentina",
        name: "Valentina",
        color: 0x31859c,
        role: Role::Researcher,
        specialty: "Local sources and opening hours",
    },
    Persona {
        key: "paolo",
        name: "Paolo",
        color: 0x7f7f7f,
        role: Role::EditorInChief,
        specialty: "Editorial direction",
    },
    Persona {
        key: "sara",
        name: "Sara",
        color: 0xc3d69b,
        role: Role::Writer,
        specialty: "Hiking and trails",
    },
];

/// Persona by id, falling back to the first entry for unknown ids.
pub fn persona(id: PersonaId) -> &'static Persona {
    PERSONAS.get(usize::from(id.0)).unwrap_or(&PERSONAS[0])
}

/// Persona id by key.
pub fn persona_by_key(key: &str) -> Option<PersonaId> {
    PERSONAS
        .iter()
        .position(|p| p.key == key)
        .and_then(|i| u16::try_from(i).ok())
        .map(PersonaId)
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
    fn personas() {
        assert_eq!(persona_by_key("marco"), Some(PersonaId(4)));
        assert_eq!(persona(PersonaId(4)).name, "Marco");
        assert_eq!(persona(PersonaId(999)).key, "isabella");
        assert_eq!(salary_for(Role::Editor, Seniority::Senior), 39_100);
    }

    #[test]
    fn traits_drive_speed() {
        assert_eq!(Traits::even(0).walk_speed(), 200);
        assert_eq!(Traits::even(1000).walk_speed(), 300);
    }
}
