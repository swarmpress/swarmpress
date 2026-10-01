//! Entity ids: `u32` newtypes, allocated sequentially from 1 by [`IdGen`].

use core::fmt;

use serde::{Deserialize, Serialize};

macro_rules! id_type {
    ($(#[$doc:meta])* $name:ident, $prefix:literal) => {
        $(#[$doc])*
        #[derive(
            Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        pub struct $name(pub u32);

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, concat!($prefix, "{}"), self.0)
            }
        }
    };
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
    /// A meeting (standup, pitch, crit).
    MeetingId,
    "meeting-"
);
id_type!(
    /// A server-side LLM job (M2+).
    JobId,
    "job-"
);

/// Index into [`crate::staff::PERSONAS`].
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
    /// The id the next [`IdGen::equip`] call will return.
    pub fn peek_equip(&self) -> EquipId {
        EquipId(self.equip + 1)
    }
    /// The id the next [`IdGen::room`] call will return.
    pub fn peek_room(&self) -> RoomId {
        RoomId(self.room + 1)
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
    }
}
