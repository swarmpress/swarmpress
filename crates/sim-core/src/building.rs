//! The building: a rectangular lot on the tile grid (1 tile = 1 m), rooms
//! placed on it, doors and windows on room sides, and the street entrance.
//!
//! Walls are implicit: an edge between two 4-adjacent tiles is a wall when
//! the tiles belong to different [`Zone`]s (two rooms, a room and the
//! hallway, the lot and the street) and no door opens that edge. Lot tiles not
//! covered by a room are hallway. Tiles outside the lot are street.
//!
//! M1 limits (loud): one floor only (`floors == 1`); furniture does not block
//! movement.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::equipment::Equipment;
use crate::geom::{PosMm, Side, Tile, TileRect, TILE_MM};
use crate::ids::{EquipId, RoomId};
use crate::pathfinding::NavGrid;

/// Street tiles kept around the lot for pathfinding (arrivals walk in from here).
pub const STREET_MARGIN: i32 = 4;
/// How far out on the street staff appear/disappear, in tiles from the entrance.
pub const SPAWN_DISTANCE: i32 = 3;
/// Half the wall thickness in millimetres (walls are 100 mm thick).
pub const WALL_HALF_MM: i32 = 50;
/// Largest lot side in tiles.
pub const MAX_LOT_SIDE: i32 = 40;
/// Largest room side in tiles.
pub const MAX_ROOM_SIDE: i32 = 24;
/// Most doors / windows a room may declare.
pub const MAX_OPENINGS: usize = 8;

/// Room kinds (plan §A "Entities").
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RoomKind {
    Newsroom,
    EditorOffice,
    MeetingRoom,
    Archive,
    PhotoStudio,
    SeoLab,
    TranslationDesk,
    DesignStudio,
    CeoOffice,
    Kitchen,
    ServerRoom,
}

impl RoomKind {
    pub const ALL: [RoomKind; 11] = [
        RoomKind::Newsroom,
        RoomKind::EditorOffice,
        RoomKind::MeetingRoom,
        RoomKind::Archive,
        RoomKind::PhotoStudio,
        RoomKind::SeoLab,
        RoomKind::TranslationDesk,
        RoomKind::DesignStudio,
        RoomKind::CeoOffice,
        RoomKind::Kitchen,
        RoomKind::ServerRoom,
    ];

    /// Company level that unlocks this room kind (plan §A "Progression").
    /// CeoOffice and ServerRoom are not in the plan's table; they unlock at 2 and 3.
    pub const fn unlock_level(self) -> u8 {
        match self {
            RoomKind::Newsroom | RoomKind::EditorOffice | RoomKind::Kitchen => 1,
            RoomKind::MeetingRoom | RoomKind::Archive | RoomKind::CeoOffice => 2,
            RoomKind::PhotoStudio | RoomKind::SeoLab | RoomKind::ServerRoom => 3,
            RoomKind::TranslationDesk | RoomKind::DesignStudio => 4,
        }
    }

    /// Minimum (w, d) in tiles.
    pub const fn min_size(self) -> (i32, i32) {
        match self {
            RoomKind::Newsroom => (4, 4),
            RoomKind::ServerRoom => (2, 2),
            _ => (3, 3),
        }
    }

    /// Floor area per person when computing capacity.
    pub const fn tiles_per_person(self) -> i64 {
        match self {
            RoomKind::Newsroom => 6,
            RoomKind::EditorOffice | RoomKind::CeoOffice => 10,
            RoomKind::MeetingRoom | RoomKind::Kitchen => 3,
            RoomKind::ServerRoom => 20,
            _ => 8,
        }
    }

    /// Construction cost per tile, cents.
    pub const fn build_cost_per_tile(self) -> i64 {
        match self {
            RoomKind::Newsroom => 25_000,
            RoomKind::EditorOffice | RoomKind::CeoOffice => 30_000,
            RoomKind::MeetingRoom | RoomKind::Kitchen | RoomKind::Archive => 20_000,
            RoomKind::PhotoStudio | RoomKind::DesignStudio => 40_000,
            RoomKind::SeoLab | RoomKind::TranslationDesk => 30_000,
            RoomKind::ServerRoom => 60_000,
        }
    }

    /// Daily upkeep per tile, cents.
    pub const fn upkeep_per_tile(self) -> i64 {
        match self {
            RoomKind::ServerRoom => 500,
            RoomKind::PhotoStudio | RoomKind::DesignStudio => 200,
            _ => 100,
        }
    }

    /// Display label.
    pub const fn label(self) -> &'static str {
        match self {
            RoomKind::Newsroom => "Newsroom",
            RoomKind::EditorOffice => "Editor's office",
            RoomKind::MeetingRoom => "Meeting room",
            RoomKind::Archive => "Archive",
            RoomKind::PhotoStudio => "Photo studio",
            RoomKind::SeoLab => "SEO lab",
            RoomKind::TranslationDesk => "Translation desk",
            RoomKind::DesignStudio => "Design studio",
            RoomKind::CeoOffice => "CEO office",
            RoomKind::Kitchen => "Kitchen",
            RoomKind::ServerRoom => "Server room",
        }
    }

    /// kebab-case name used at the JSON boundary.
    pub const fn slug(self) -> &'static str {
        match self {
            RoomKind::Newsroom => "newsroom",
            RoomKind::EditorOffice => "editor-office",
            RoomKind::MeetingRoom => "meeting-room",
            RoomKind::Archive => "archive",
            RoomKind::PhotoStudio => "photo-studio",
            RoomKind::SeoLab => "seo-lab",
            RoomKind::TranslationDesk => "translation-desk",
            RoomKind::DesignStudio => "design-studio",
            RoomKind::CeoOffice => "ceo-office",
            RoomKind::Kitchen => "kitchen",
            RoomKind::ServerRoom => "server-room",
        }
    }
}

/// A one-tile door in a room side, `at` tiles from the side's start.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Door {
    pub side: Side,
    pub at: i32,
}

/// A window opening on an exterior room side, offset and width in millimetres.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Window {
    pub side: Side,
    pub at_mm: i32,
    pub width_mm: i32,
}

/// The street entrance: a door from `tile` (inside the lot) through `side`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entrance {
    pub tile: Tile,
    pub side: Side,
}

impl Entrance {
    /// First street tile outside the entrance.
    pub const fn outside_tile(&self) -> Tile {
        self.tile.neighbour(self.side)
    }

    /// Where arriving staff appear and leaving staff disappear.
    pub fn spawn_pos(&self) -> PosMm {
        let (dx, dz) = self.side.delta();
        Tile::new(
            self.tile.x + dx * SPAWN_DISTANCE,
            self.tile.z + dz * SPAWN_DISTANCE,
        )
        .center()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    pub id: RoomId,
    pub kind: RoomKind,
    pub rect: TileRect,
    pub floor: u8,
    /// Upgrade level, starts at 1.
    pub level: u8,
    pub doors: Vec<Door>,
    pub windows: Vec<Window>,
}

impl Room {
    /// People the room seats/holds.
    pub fn capacity(&self) -> u16 {
        let cap = self.rect.area() / self.kind.tiles_per_person();
        u16::try_from(cap.max(1)).unwrap_or(u16::MAX)
    }

    /// Whether any window still faces the outside (sides can become interior
    /// after the lot grows).
    pub fn has_daylight(&self, lot: &TileRect) -> bool {
        self.windows
            .iter()
            .any(|w| self.rect.side_on_boundary_of(lot, w.side))
    }

    /// Canonical edges opened by this room's doors.
    pub fn door_edges(&self) -> impl Iterator<Item = EdgeKey> + '_ {
        self.doors
            .iter()
            .map(|d| EdgeKey::of(self.rect.side_tile(d.side, d.at), d.side))
    }
}

/// What a tile belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Zone {
    Street,
    Hallway,
    Room(RoomId),
}

/// Canonical name for the edge between two 4-adjacent tiles: the edge on the
/// east side (`east == true`) or south side of `tile`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct EdgeKey {
    pub tile: Tile,
    pub east: bool,
}

impl EdgeKey {
    pub const fn of(tile: Tile, side: Side) -> EdgeKey {
        match side {
            Side::East => EdgeKey { tile, east: true },
            Side::South => EdgeKey { tile, east: false },
            Side::West => EdgeKey {
                tile: tile.neighbour(Side::West),
                east: true,
            },
            Side::North => EdgeKey {
                tile: tile.neighbour(Side::North),
                east: false,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Building {
    /// Owned land; grows with `BuyFloorSpace`.
    pub lot: TileRect,
    /// Floors in the building. M1: always 1 (upper floors need stairs, M2+).
    pub floors: u8,
    pub entrance: Entrance,
    pub rooms: BTreeMap<RoomId, Room>,
    pub equipment: BTreeMap<EquipId, Equipment>,
}

impl Building {
    pub fn new(lot: TileRect, entrance: Entrance) -> Building {
        Building {
            lot,
            floors: 1,
            entrance,
            rooms: BTreeMap::new(),
            equipment: BTreeMap::new(),
        }
    }

    /// The default empty 16×10 lot with the entrance on the south side.
    pub fn default_lot() -> Building {
        let lot = TileRect::new(0, 0, 16, 10);
        Building::new(
            lot,
            Entrance {
                tile: Tile::new(4, 9),
                side: Side::South,
            },
        )
    }

    pub fn room_at(&self, t: Tile) -> Option<RoomId> {
        self.rooms
            .values()
            .find(|r| r.rect.contains(t))
            .map(|r| r.id)
    }

    pub fn zone(&self, t: Tile) -> Zone {
        if !self.lot.contains(t) {
            Zone::Street
        } else if let Some(id) = self.room_at(t) {
            Zone::Room(id)
        } else {
            Zone::Hallway
        }
    }

    /// All open door edges, including the entrance.
    pub fn door_edges(&self) -> BTreeSet<EdgeKey> {
        let mut set: BTreeSet<EdgeKey> = self.rooms.values().flat_map(Room::door_edges).collect();
        set.insert(EdgeKey::of(self.entrance.tile, self.entrance.side));
        set
    }

    /// Whether the edge on `side` of `t` is a (closed) wall.
    pub fn is_wall_edge(&self, t: Tile, side: Side, doors: &BTreeSet<EdgeKey>) -> bool {
        self.zone(t) != self.zone(t.neighbour(side)) && !doors.contains(&EdgeKey::of(t, side))
    }

    /// Whether a point lies inside a wall's thickness (outside door gaps).
    /// Corner caps are ignored; movement never cuts corners on the grid.
    pub fn point_in_wall(&self, p: PosMm) -> bool {
        let doors = self.door_edges();
        let t = p.tile();
        let fx = p.x.rem_euclid(TILE_MM);
        let fz = p.z.rem_euclid(TILE_MM);
        (fx <= WALL_HALF_MM && self.is_wall_edge(t, Side::West, &doors))
            || (fx >= TILE_MM - WALL_HALF_MM && self.is_wall_edge(t, Side::East, &doors))
            || (fz <= WALL_HALF_MM && self.is_wall_edge(t, Side::North, &doors))
            || (fz >= TILE_MM - WALL_HALF_MM && self.is_wall_edge(t, Side::South, &doors))
    }

    /// Where staff appear from / vanish to on the street.
    pub fn spawn_pos(&self) -> PosMm {
        self.entrance.spawn_pos()
    }

    /// Bounds of the navigation grid: the lot plus a street margin that always
    /// contains the spawn point.
    pub fn nav_bounds(&self) -> TileRect {
        self.lot.expanded(STREET_MARGIN)
    }

    pub fn nav_grid(&self) -> NavGrid {
        NavGrid::build(self)
    }

    /// Every room must be reachable from the street through doors.
    pub fn first_unreachable_room(&self) -> Option<RoomId> {
        let grid = self.nav_grid();
        let reach = grid.reachable_from(self.entrance.outside_tile());
        self.rooms
            .values()
            .find(|r| {
                !r.rect
                    .tiles()
                    .any(|t| grid.index(t).is_some_and(|i| reach[i]))
            })
            .map(|r| r.id)
    }

    /// Lowest-id room of a kind.
    pub fn first_room_of(&self, kind: RoomKind) -> Option<&Room> {
        self.rooms.values().find(|r| r.kind == kind)
    }

    /// Ceiling lights placed automatically with a room: one per ~6×6 m cell,
    /// centred in the cell.
    pub fn auto_light_positions(rect: &TileRect) -> Vec<PosMm> {
        let cols = (rect.w + 5) / 6;
        let rows = (rect.d + 5) / 6;
        let mut out = Vec::new();
        for j in 0..rows {
            for i in 0..cols {
                out.push(PosMm::new(
                    rect.x * TILE_MM + rect.w * TILE_MM * (2 * i + 1) / (2 * cols),
                    rect.z * TILE_MM + rect.d * TILE_MM * (2 * j + 1) / (2 * rows),
                ));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(id: u32, kind: RoomKind, rect: TileRect, doors: Vec<Door>) -> Room {
        Room {
            id: RoomId(id),
            kind,
            rect,
            floor: 0,
            level: 1,
            doors,
            windows: vec![],
        }
    }

    fn sample() -> Building {
        let mut b = Building::default_lot();
        b.rooms.insert(
            RoomId(1),
            room(
                1,
                RoomKind::Newsroom,
                TileRect::new(0, 0, 10, 10),
                vec![Door {
                    side: Side::East,
                    at: 2,
                }],
            ),
        );
        b.rooms.insert(
            RoomId(2),
            room(
                2,
                RoomKind::EditorOffice,
                TileRect::new(10, 0, 6, 5),
                vec![],
            ),
        );
        b
    }

    #[test]
    fn zones_and_walls() {
        let b = sample();
        let doors = b.door_edges();
        assert_eq!(b.zone(Tile::new(0, 0)), Zone::Room(RoomId(1)));
        assert_eq!(b.zone(Tile::new(12, 7)), Zone::Hallway);
        assert_eq!(b.zone(Tile::new(-1, 0)), Zone::Street);
        // newsroom ↔ editor through the door at z=2, wall at z=3
        assert!(!b.is_wall_edge(Tile::new(9, 2), Side::East, &doors));
        assert!(b.is_wall_edge(Tile::new(9, 3), Side::East, &doors));
        // entrance
        assert!(!b.is_wall_edge(Tile::new(4, 9), Side::South, &doors));
        assert!(b.is_wall_edge(Tile::new(3, 9), Side::South, &doors));
        // inside a room: no wall
        assert!(!b.is_wall_edge(Tile::new(3, 3), Side::East, &doors));
    }

    #[test]
    fn point_in_wall_respects_doors() {
        let b = sample();
        assert!(b.point_in_wall(PosMm::new(10_000, 3_500)));
        assert!(b.point_in_wall(PosMm::new(9_960, 3_500)));
        assert!(!b.point_in_wall(PosMm::new(10_000, 2_500)));
        assert!(!b.point_in_wall(PosMm::new(5_000, 5_000)));
        assert!(!b.point_in_wall(PosMm::new(4_500, 10_000)));
        assert!(b.point_in_wall(PosMm::new(3_500, 10_000)));
    }

    #[test]
    fn connectivity() {
        let mut b = sample();
        assert_eq!(b.first_unreachable_room(), None);
        // A sealed room in the hallway is unreachable.
        b.rooms.insert(
            RoomId(3),
            room(3, RoomKind::Kitchen, TileRect::new(12, 6, 3, 3), vec![]),
        );
        assert_eq!(b.first_unreachable_room(), Some(RoomId(3)));
        b.rooms.get_mut(&RoomId(3)).unwrap().doors.push(Door {
            side: Side::North,
            at: 0,
        });
        // the hallway it opens onto is itself sealed off
        assert_eq!(b.first_unreachable_room(), Some(RoomId(3)));
        b.rooms.get_mut(&RoomId(1)).unwrap().doors.push(Door {
            side: Side::East,
            at: 7,
        });
        assert_eq!(b.first_unreachable_room(), None);
    }

    #[test]
    fn daylight_needs_exterior_windows() {
        let b = sample();
        let mut r = b.rooms[&RoomId(1)].clone();
        assert!(!r.has_daylight(&b.lot));
        r.windows.push(Window {
            side: Side::North,
            at_mm: 1500,
            width_mm: 2500,
        });
        assert!(r.has_daylight(&b.lot));
        let bigger = TileRect::new(0, -2, 16, 12);
        assert!(!r.has_daylight(&bigger));
    }

    #[test]
    fn auto_lights() {
        assert_eq!(
            Building::auto_light_positions(&TileRect::new(10, 0, 6, 5)),
            vec![PosMm::new(13_000, 2_500)]
        );
        assert_eq!(
            Building::auto_light_positions(&TileRect::new(0, 0, 10, 10)).len(),
            4
        );
    }

    #[test]
    fn capacity_from_area() {
        let r = room(1, RoomKind::Newsroom, TileRect::new(0, 0, 10, 10), vec![]);
        assert_eq!(r.capacity(), 16);
        let r = room(1, RoomKind::ServerRoom, TileRect::new(0, 0, 2, 2), vec![]);
        assert_eq!(r.capacity(), 1);
    }
}
