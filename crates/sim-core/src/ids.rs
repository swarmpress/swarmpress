//! Entity ids: `u32` newtypes, allocated sequentially from 1 by [`IdGen`].
//!
//! Serde: binary formats (postcard, and therefore the world hash) carry the
//! bare `u32`; human-readable formats (JSON at the client boundary) carry the
//! string form (`"staff-3"`) and also accept a bare number on input.

use core::fmt;

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

macro_rules! id_type {
    ($(#[$doc:meta])* $name:ident, $prefix:literal) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub u32);

        impl $name {
            /// String prefix of the human-readable form, e.g. `"staff-"`.
            pub const PREFIX: &'static str = $prefix;

            /// Parses `"<prefix>N"` or a bare `"N"`.
            pub fn parse(s: &str) -> Option<$name> {
                let digits = s.strip_prefix($prefix).unwrap_or(s);
                digits.parse::<u32>().ok().map($name)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, concat!($prefix, "{}"), self.0)
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                if s.is_human_readable() {
                    s.collect_str(self)
                } else {
                    s.serialize_newtype_struct(stringify!($name), &self.0)
                }
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let v = IdVisitor::new($prefix, $name);
                if d.is_human_readable() {
                    d.deserialize_any(v)
                } else {
                    d.deserialize_newtype_struct(stringify!($name), v)
                }
            }
        }
    };
}

/// Visitor shared by every id type: a newtype-wrapped `u32` (postcard), a
/// number, or a `"prefix-N"` string (JSON).
struct IdVisitor<T> {
    prefix: &'static str,
    make: fn(u32) -> T,
}

impl<T> IdVisitor<T> {
    fn new(prefix: &'static str, make: fn(u32) -> T) -> Self {
        IdVisitor { prefix, make }
    }
}

impl<'de, T> Visitor<'de> for IdVisitor<T> {
    type Value = T;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "an id like \"{}1\" or a non-negative integer",
            self.prefix
        )
    }

    fn visit_newtype_struct<D: Deserializer<'de>>(self, d: D) -> Result<T, D::Error> {
        u32::deserialize(d).map(self.make)
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<T, E> {
        u32::try_from(v)
            .map(self.make)
            .map_err(|_| E::invalid_value(de::Unexpected::Unsigned(v), &self))
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<T, E> {
        u32::try_from(v)
            .map(self.make)
            .map_err(|_| E::invalid_value(de::Unexpected::Signed(v), &self))
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<T, E> {
        let digits = v.strip_prefix(self.prefix).unwrap_or(v);
        digits
            .parse::<u32>()
            .map(self.make)
            .map_err(|_| E::invalid_value(de::Unexpected::Str(v), &self))
    }
}

id_type!(
    /// A room in the building.
    RoomId,
    "room-"
);
id_type!(
    /// A piece of equipment (desk, monitor, light, prop).
    EquipId,
    "equip-"
);
id_type!(
    /// An employee.
    StaffId,
    "staff-"
);
id_type!(
    /// A hiring candidate on today's shortlist.
    CandidateId,
    "candidate-"
);
id_type!(
    /// A meeting (standup, finance review, KPI review, scheduled).
    MeetingId,
    "meeting-"
);
id_type!(
    /// A server-side LLM job (M2+).
    JobId,
    "job-"
);
id_type!(
    /// A publication the company runs (ADR-0029), e.g. cinqueterre.travel.
    ProjectId,
    "project-"
);
id_type!(
    /// An Inbox ticket (QuestionTicket) for the CEO.
    TicketId,
    "ticket-"
);
id_type!(
    /// A task delegated to the Executive Secretary.
    TaskId,
    "task-"
);
id_type!(
    /// A unit of planned work inside a project: the publishing plan's
    /// `WorkItem` (ADR-0031), formerly called the pipeline "project". Reserved:
    /// work items themselves land with the plan.
    WorkItemId,
    "work-item-"
);

/// Stable persona number from the catalog (`crates/agents/personas/*.toml`,
/// field `id`); see [`crate::staff::PERSONAS`]. Serialized as a plain number.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub struct PersonaId(pub u16);

/// Sequential id allocator, one counter per entity kind. Ids start at 1.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdGen {
    room: u32,
    equip: u32,
    staff: u32,
    candidate: u32,
    meeting: u32,
    project: u32,
    ticket: u32,
    task: u32,
}

impl IdGen {
    pub fn room(&mut self) -> RoomId {
        self.room += 1;
        RoomId(self.room)
    }
    pub fn equip(&mut self) -> EquipId {
        self.equip += 1;
        EquipId(self.equip)
    }
    pub fn staff(&mut self) -> StaffId {
        self.staff += 1;
        StaffId(self.staff)
    }
    pub fn candidate(&mut self) -> CandidateId {
        self.candidate += 1;
        CandidateId(self.candidate)
    }
    pub fn meeting(&mut self) -> MeetingId {
        self.meeting += 1;
        MeetingId(self.meeting)
    }
    pub fn project(&mut self) -> ProjectId {
        self.project += 1;
        ProjectId(self.project)
    }
    pub fn ticket(&mut self) -> TicketId {
        self.ticket += 1;
        TicketId(self.ticket)
    }
    pub fn task(&mut self) -> TaskId {
        self.task += 1;
        TaskId(self.task)
    }
    /// The id the next [`IdGen::equip`] call will return.
    pub fn peek_equip(&self) -> EquipId {
        EquipId(self.equip + 1)
    }
    /// The id the next [`IdGen::room`] call will return.
    pub fn peek_room(&self) -> RoomId {
        RoomId(self.room + 1)
    }
    /// The id the next [`IdGen::project`] call will return.
    pub fn peek_project(&self) -> ProjectId {
        ProjectId(self.project + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_sequential_per_kind() {
        let mut g = IdGen::default();
        assert_eq!(g.peek_room(), RoomId(1));
        assert_eq!(g.room(), RoomId(1));
        assert_eq!(g.room(), RoomId(2));
        assert_eq!(g.equip(), EquipId(1));
        assert_eq!(g.peek_equip(), EquipId(2));
        assert_eq!(g.staff(), StaffId(1));
        assert_eq!(RoomId(7).to_string(), "room-7");
        assert_eq!(g.peek_project(), ProjectId(1));
        assert_eq!(g.project(), ProjectId(1));
        assert_eq!(g.ticket(), TicketId(1));
        assert_eq!(g.task(), TaskId(1));
        assert_eq!(WorkItemId(4).to_string(), "work-item-4");
    }

    #[test]
    fn ids_are_numbers_in_postcard_and_strings_in_json() {
        let id = StaffId(300);
        let bytes = postcard::to_allocvec(&id).unwrap();
        assert_eq!(bytes, postcard::to_allocvec(&300u32).unwrap());
        assert_eq!(postcard::from_bytes::<StaffId>(&bytes).unwrap(), id);
        assert_eq!(serde_json::to_string(&id).unwrap(), "\"staff-300\"");
        assert_eq!(
            serde_json::from_str::<StaffId>("\"staff-300\"").unwrap(),
            id
        );
        assert_eq!(serde_json::from_str::<StaffId>("300").unwrap(), id);
        assert_eq!(serde_json::from_str::<StaffId>("\"300\"").unwrap(), id);
        assert!(serde_json::from_str::<StaffId>("\"staff-x\"").is_err());
        assert!(serde_json::from_str::<StaffId>("-1").is_err());
        assert_eq!(TicketId::parse("ticket-3"), Some(TicketId(3)));
        assert_eq!(ProjectId::parse("nope"), None);
    }
}
