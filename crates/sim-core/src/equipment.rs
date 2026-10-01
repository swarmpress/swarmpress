//! Equipment: desks, desk attachments (monitor, lamp), ceiling lights and
//! room props. Device state ([`DeviceState`]) is derived from the world each
//! time it is read (see [`crate::render_state`]), never stored.

use serde::{Deserialize, Serialize};

use crate::building::RoomKind;
use crate::geom::PosMm;
use crate::ids::{EquipId, RoomId, StaffId};

/// Distance from a desk's centre to its chair, millimetres.
pub const SEAT_OFFSET_MM: i32 = 750;
/// Floor items must keep this distance from the room walls.
pub const WALL_CLEARANCE_MM: i32 = 300;
/// A desk's chair must keep this distance from the room walls.
pub const SEAT_CLEARANCE_MM: i32 = 200;
/// Most equipment items in one room.
pub const MAX_ITEMS_PER_ROOM: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum EquipmentKind {
    Desk,
    Monitor,
    DeskLamp,
    CeilingLight,
    Whiteboard,
    ArchiveShelf,
    CoffeeMachine,
    Plant,
    CameraRig,
    ColorMonitor,
    MoodBoardWall,
}

/// Which desk slot an attachment occupies.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum DeskSlot {
    Screen,
    Lamp,
}

impl EquipmentKind {
    pub const ALL: [EquipmentKind; 11] = [
        EquipmentKind::Desk,
        EquipmentKind::Monitor,
        EquipmentKind::DeskLamp,
        EquipmentKind::CeilingLight,
        EquipmentKind::Whiteboard,
        EquipmentKind::ArchiveShelf,
        EquipmentKind::CoffeeMachine,
        EquipmentKind::Plant,
        EquipmentKind::CameraRig,
        EquipmentKind::ColorMonitor,
        EquipmentKind::MoodBoardWall,
    ];

    /// Purchase price, cents.
    pub const fn cost(self) -> i64 {
        match self {
            EquipmentKind::Desk => 40_000,
            EquipmentKind::Monitor => 30_000,
            EquipmentKind::DeskLamp => 6_000,
            EquipmentKind::CeilingLight => 12_000,
            EquipmentKind::Whiteboard => 20_000,
            EquipmentKind::ArchiveShelf => 35_000,
            EquipmentKind::CoffeeMachine => 80_000,
            EquipmentKind::Plant => 5_000,
            EquipmentKind::CameraRig => 250_000,
            EquipmentKind::ColorMonitor => 120_000,
            EquipmentKind::MoodBoardWall => 60_000,
        }
    }

    /// Daily upkeep (power, consumables), cents.
    pub const fn upkeep(self) -> i64 {
        match self {
            EquipmentKind::Monitor => 50,
            EquipmentKind::DeskLamp => 10,
            EquipmentKind::CeilingLight => 20,
            EquipmentKind::CoffeeMachine => 300,
            EquipmentKind::CameraRig => 500,
            EquipmentKind::ColorMonitor => 100,
            EquipmentKind::Plant => 30,
            EquipmentKind::Desk
            | EquipmentKind::Whiteboard
            | EquipmentKind::ArchiveShelf
            | EquipmentKind::MoodBoardWall => 0,
        }
    }

    /// Half the floor footprint (Chebyshev), mm. 0 = does not take floor space.
    pub const fn footprint_mm(self) -> i32 {
        match self {
            EquipmentKind::Desk => 600,
            EquipmentKind::Whiteboard
            | EquipmentKind::ArchiveShelf
            | EquipmentKind::CameraRig
            | EquipmentKind::MoodBoardWall => 500,
            EquipmentKind::CoffeeMachine => 400,
            EquipmentKind::Plant => 300,
            EquipmentKind::Monitor
            | EquipmentKind::DeskLamp
            | EquipmentKind::CeilingLight
            | EquipmentKind::ColorMonitor => 0,
        }
    }

    /// Slot taken on a desk, for items that sit on desks.
    pub const fn desk_slot(self) -> Option<DeskSlot> {
        match self {
            EquipmentKind::Monitor | EquipmentKind::ColorMonitor => Some(DeskSlot::Screen),
            EquipmentKind::DeskLamp => Some(DeskSlot::Lamp),
            _ => None,
        }
    }

    /// Room kinds this item may be placed in (`None` = any).
    pub const fn required_room(self) -> Option<RoomKind> {
        match self {
            EquipmentKind::CameraRig => Some(RoomKind::PhotoStudio),
            EquipmentKind::MoodBoardWall => Some(RoomKind::DesignStudio),
            _ => None,
        }
    }

    /// kebab-case name used at the JSON boundary.
    pub const fn slug(self) -> &'static str {
        match self {
            EquipmentKind::Desk => "desk",
            EquipmentKind::Monitor => "monitor",
            EquipmentKind::DeskLamp => "desk-lamp",
            EquipmentKind::CeilingLight => "ceiling-light",
            EquipmentKind::Whiteboard => "whiteboard",
            EquipmentKind::ArchiveShelf => "archive-shelf",
            EquipmentKind::CoffeeMachine => "coffee-machine",
            EquipmentKind::Plant => "plant",
            EquipmentKind::CameraRig => "camera-rig",
            EquipmentKind::ColorMonitor => "color-monitor",
            EquipmentKind::MoodBoardWall => "mood-board-wall",
        }
    }
}

/// Derived device state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum DeviceState {
    Off,
    On,
    InUse(StaffId),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Equipment {
    pub id: EquipId,
    pub kind: EquipmentKind,
    pub room: RoomId,
    /// Centre on the floor (desk attachments share their desk's position).
    pub pos: PosMm,
    /// Quarter turns clockwise seen from above, 0..4. 0 = chair on the south side.
    pub rot: u8,
    /// Desk this item sits on.
    pub attached_to: Option<EquipId>,
}

impl Equipment {
    /// Where a person sits to use this desk.
    pub fn seat_pos(&self) -> PosMm {
        seat_pos(self.pos, self.rot)
    }
}

/// Chair position for a desk at `pos` with rotation `rot`.
pub const fn seat_pos(pos: PosMm, rot: u8) -> PosMm {
    let (dx, dz) = match rot % 4 {
        0 => (0, SEAT_OFFSET_MM),
        1 => (-SEAT_OFFSET_MM, 0),
        2 => (0, -SEAT_OFFSET_MM),
        _ => (SEAT_OFFSET_MM, 0),
    };
    PosMm::new(pos.x + dx, pos.z + dz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seat_positions_follow_rotation() {
        let p = PosMm::new(13_000, 2_500);
        assert_eq!(seat_pos(p, 0), PosMm::new(13_000, 3_250));
        assert_eq!(seat_pos(p, 2), PosMm::new(13_000, 1_750));
        assert_eq!(seat_pos(p, 1), PosMm::new(12_250, 2_500));
        assert_eq!(seat_pos(p, 3), PosMm::new(13_750, 2_500));
    }

    #[test]
    fn desk_slots() {
        assert_eq!(EquipmentKind::Monitor.desk_slot(), Some(DeskSlot::Screen));
        assert_eq!(
            EquipmentKind::ColorMonitor.desk_slot(),
            Some(DeskSlot::Screen)
        );
        assert_eq!(EquipmentKind::DeskLamp.desk_slot(), Some(DeskSlot::Lamp));
        assert_eq!(EquipmentKind::Desk.desk_slot(), None);
        for k in EquipmentKind::ALL {
            assert!(k.cost() > 0);
            assert!(!k.slug().is_empty());
        }
    }
}
