//! The closed vocabulary (room kinds, equipment designs, sides) and the room the
//! designer plans for, with the sim's rules mirrored as constants.
//!
//! The sim is not a dependency (it is a dev-dependency for the contract tests in
//! `tests/sim_contract.rs`, which check every mirrored number against
//! `sim-core`). Units: millimetres, integers; x grows east, z grows south.

use serde::{Deserialize, Serialize};

// ------------------------------------------------------------------ the sim's rules

/// Distance from a desk's centre to its chair (`sim_core::equipment::SEAT_OFFSET_MM`).
pub const SEAT_OFFSET_MM: i32 = 750;
/// Floor items keep their centre this far from the room's walls (`WALL_CLEARANCE_MM`).
pub const WALL_CLEARANCE_MM: i32 = 300;
/// A desk's chair keeps this far from the walls (`SEAT_CLEARANCE_MM`).
pub const SEAT_CLEARANCE_MM: i32 = 200;
/// Most equipment items in one room (`MAX_ITEMS_PER_ROOM`).
pub const MAX_ITEMS_PER_ROOM: usize = 64;
/// Two ceiling lights keep their centres this far apart (`CEILING_LIGHT_SPACING_MM`).
pub const CEILING_LIGHT_SPACING_MM: i32 = 500;
/// Seat offsets around the room centre for meetings and the kitchen table
/// (`sim_core::staff::ROUND_TABLE_SEATS`).
pub const TABLE_SEATS: [(i32, i32); 12] = [
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
/// Table seats keep this far off the walls (the sim's `table_seat` clamp).
pub const TABLE_SEAT_WALL_MM: i32 = 400;
/// Millimetres per tile (a sim door is one tile wide).
pub const TILE_MM: i32 = 1000;

// ------------------------------------------------------------------ the designer's rules

/// 2 studs = 125 mm: solved positions lie on this grid (whole studs in mm).
pub const GRID_MM: i32 = 125;
/// Wall thickness inside the room's rect: one stud, rounded up (the kit's shell).
pub const WALL_MM: i32 = 63;
/// The clear zone in front of every door, measured into the room.
pub const DOOR_CLEAR_DEPTH_MM: i32 = 1000;
/// Half a walking person: obstacles and walls are grown by this for walkability.
pub const BODY_MM: i32 = 250;
/// A seat or door counts as reached when a walkable cell lies this close (Chebyshev).
pub const REACH_MM: i32 = 375;
/// Walkability grid cell.
pub const WALK_CELL_MM: i32 = 125;
/// A ceiling light lights desks whose centre lies within this distance.
pub const LIGHT_REACH_MM: i32 = 2500;
/// A window lights desks whose centre lies within this distance of the opening.
pub const WINDOW_REACH_MM: i32 = 3000;
/// Most placements in one plan.
pub const MAX_PLACEMENTS: usize = 32;
/// Most copies in one placement's row.
pub const MAX_COUNT: u8 = 8;
/// Largest gap, offset or spacing, studs (24 m, the sim's largest room side).
pub const MAX_STUDS: u16 = 384;

/// Studs to millimetres, rounded half up (1 stud = 62.5 mm).
pub const fn studs_mm(studs: u16) -> i32 {
    (studs as i32 * 125 + 1) / 2
}

/// Half of a stud length in millimetres, rounded up (an extent from a centre).
pub const fn half_studs_mm(studs: u32) -> i32 {
    (studs as i32 * 125 + 3) / 4
}

// ------------------------------------------------------------------ sides

/// Compass side. North is −z, east is +x.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Side {
    North,
    East,
    South,
    West,
}

impl Side {
    pub const ALL: [Side; 4] = [Side::North, Side::East, Side::South, Side::West];

    pub const fn slug(self) -> &'static str {
        match self {
            Side::North => "north",
            Side::East => "east",
            Side::South => "south",
            Side::West => "west",
        }
    }

    pub fn from_slug(s: &str) -> Option<Side> {
        Side::ALL.into_iter().find(|x| x.slug() == s)
    }

    pub const fn opposite(self) -> Side {
        match self {
            Side::North => Side::South,
            Side::East => Side::West,
            Side::South => Side::North,
            Side::West => Side::East,
        }
    }

    /// Whether the wall on this side runs along x (north and south walls).
    pub const fn runs_along_x(self) -> bool {
        matches!(self, Side::North | Side::South)
    }

    /// Unit step in this direction.
    pub const fn delta(self) -> (i32, i32) {
        match self {
            Side::North => (0, -1),
            Side::East => (1, 0),
            Side::South => (0, 1),
            Side::West => (-1, 0),
        }
    }

    /// The sim's `rot` that turns an item's front (its chair side for a desk)
    /// toward this side: at rot 0 the front faces south, turns are clockwise.
    pub const fn front_rot(self) -> u8 {
        match self {
            Side::South => 0,
            Side::West => 1,
            Side::North => 2,
            Side::East => 3,
        }
    }

    /// The side an item's front faces at `rot`.
    pub const fn of_rot(rot: u8) -> Side {
        match rot % 4 {
            0 => Side::South,
            1 => Side::West,
            2 => Side::North,
            _ => Side::East,
        }
    }
}

// ------------------------------------------------------------------ room kinds

/// The sim's room kinds (`sim_core::building::RoomKind`), by slug.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
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
    FinanceOffice,
    StrategyRoom,
}

impl RoomKind {
    pub const ALL: [RoomKind; 13] = [
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
        RoomKind::FinanceOffice,
        RoomKind::StrategyRoom,
    ];

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
            RoomKind::FinanceOffice => "finance-office",
            RoomKind::StrategyRoom => "strategy-room",
        }
    }

    /// The sim's label (`RoomKind::label`).
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
            RoomKind::FinanceOffice => "Finance office",
            RoomKind::StrategyRoom => "Strategy room",
        }
    }

    /// Floor tiles per person (`RoomKind::tiles_per_person`).
    pub const fn tiles_per_person(self) -> i64 {
        match self {
            RoomKind::Newsroom => 6,
            RoomKind::EditorOffice | RoomKind::CeoOffice => 10,
            RoomKind::MeetingRoom | RoomKind::Kitchen | RoomKind::StrategyRoom => 3,
            RoomKind::ServerRoom => 20,
            _ => 8,
        }
    }

    /// Rooms where the sim seats people around a table in the middle
    /// (meetings: meeting and strategy rooms; lunch: the kitchen). The
    /// renderer draws the kit's `meeting-table` there; it is a fixture, not
    /// equipment, so the designer keeps it clear.
    pub const fn holds_table(self) -> bool {
        matches!(
            self,
            RoomKind::MeetingRoom | RoomKind::Kitchen | RoomKind::StrategyRoom
        )
    }
}

// ------------------------------------------------------------------ equipment designs

/// What the sim's desk slot an attachment takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeskSlot {
    Screen,
    Lamp,
}

/// The equipment designs the designer may place: exactly the sim's
/// `EquipmentKind`s, each drawn by the kit design of the same id
/// (`kit/mapping.json`). A closed enum: an unknown id is a validation error.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EquipmentDesign {
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

impl EquipmentDesign {
    pub const ALL: [EquipmentDesign; 11] = [
        EquipmentDesign::Desk,
        EquipmentDesign::Monitor,
        EquipmentDesign::DeskLamp,
        EquipmentDesign::CeilingLight,
        EquipmentDesign::Whiteboard,
        EquipmentDesign::ArchiveShelf,
        EquipmentDesign::CoffeeMachine,
        EquipmentDesign::Plant,
        EquipmentDesign::CameraRig,
        EquipmentDesign::ColorMonitor,
        EquipmentDesign::MoodBoardWall,
    ];

    /// The sim's `EquipmentKind::slug`, also the kit design id.
    pub const fn slug(self) -> &'static str {
        match self {
            EquipmentDesign::Desk => "desk",
            EquipmentDesign::Monitor => "monitor",
            EquipmentDesign::DeskLamp => "desk-lamp",
            EquipmentDesign::CeilingLight => "ceiling-light",
            EquipmentDesign::Whiteboard => "whiteboard",
            EquipmentDesign::ArchiveShelf => "archive-shelf",
            EquipmentDesign::CoffeeMachine => "coffee-machine",
            EquipmentDesign::Plant => "plant",
            EquipmentDesign::CameraRig => "camera-rig",
            EquipmentDesign::ColorMonitor => "color-monitor",
            EquipmentDesign::MoodBoardWall => "mood-board-wall",
        }
    }

    pub fn from_slug(s: &str) -> Option<EquipmentDesign> {
        EquipmentDesign::ALL.into_iter().find(|d| d.slug() == s)
    }

    /// Purchase price, cents (`EquipmentKind::cost`).
    pub const fn cost(self) -> i64 {
        match self {
            EquipmentDesign::Desk => 40_000,
            EquipmentDesign::Monitor => 30_000,
            EquipmentDesign::DeskLamp => 6_000,
            EquipmentDesign::CeilingLight => 12_000,
            EquipmentDesign::Whiteboard => 20_000,
            EquipmentDesign::ArchiveShelf => 35_000,
            EquipmentDesign::CoffeeMachine => 80_000,
            EquipmentDesign::Plant => 5_000,
            EquipmentDesign::CameraRig => 250_000,
            EquipmentDesign::ColorMonitor => 120_000,
            EquipmentDesign::MoodBoardWall => 60_000,
        }
    }

    /// The sim's spacing radius (`EquipmentKind::footprint_mm`): two floor
    /// items' centres stay at least the sum apart (Chebyshev). 0 = no floor space.
    pub const fn sim_footprint_mm(self) -> i32 {
        match self {
            EquipmentDesign::Desk => 600,
            EquipmentDesign::Whiteboard
            | EquipmentDesign::ArchiveShelf
            | EquipmentDesign::CameraRig
            | EquipmentDesign::MoodBoardWall => 500,
            EquipmentDesign::CoffeeMachine => 400,
            EquipmentDesign::Plant => 300,
            EquipmentDesign::Monitor
            | EquipmentDesign::DeskLamp
            | EquipmentDesign::CeilingLight
            | EquipmentDesign::ColorMonitor => 0,
        }
    }

    /// The desk slot an attachment takes (`EquipmentKind::desk_slot`).
    pub const fn desk_slot(self) -> Option<DeskSlot> {
        match self {
            EquipmentDesign::Monitor | EquipmentDesign::ColorMonitor => Some(DeskSlot::Screen),
            EquipmentDesign::DeskLamp => Some(DeskSlot::Lamp),
            _ => None,
        }
    }

    /// The only room kind this item may go in (`EquipmentKind::required_room`).
    pub const fn required_room(self) -> Option<RoomKind> {
        match self {
            EquipmentDesign::CameraRig => Some(RoomKind::PhotoStudio),
            EquipmentDesign::MoodBoardWall => Some(RoomKind::DesignStudio),
            _ => None,
        }
    }

    /// Hung from the ceiling: no floor footprint, only light spacing.
    pub const fn is_ceiling(self) -> bool {
        matches!(self, EquipmentDesign::CeilingLight)
    }

    /// Takes floor space (not an attachment, not on the ceiling).
    pub const fn is_floor(self) -> bool {
        self.desk_slot().is_none() && !self.is_ceiling()
    }

    pub fn allowed_in(self, room: RoomKind) -> bool {
        self.required_room().is_none_or(|r| r == room)
    }
}

// ------------------------------------------------------------------ the room

/// A door or window opening in one of the room's sides. `at_mm` is measured
/// from the side's west end (north and south sides) or north end (east and
/// west sides). A sim door `{side, at}` is `{side, at_mm: at × 1000, width_mm: 1000}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Opening {
    pub side: Side,
    pub at_mm: i32,
    pub width_mm: i32,
}

/// A piece of equipment already in the room. `on_desk` names the desk an
/// attachment sits on (its position is the desk's).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExistingItem {
    /// The sim's id (`equip-12`).
    pub id: String,
    pub design: EquipmentDesign,
    pub x_mm: i32,
    pub z_mm: i32,
    #[serde(default)]
    pub rot: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_desk: Option<String>,
}

impl ExistingItem {
    pub fn pos(&self) -> Pos {
        Pos::new(self.x_mm, self.z_mm)
    }
}

/// A desk-top object's desk and the slot it takes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ObjectOnDesk {
    /// The desk's id (`equip-3`).
    pub desk: String,
    pub slot: DeskSlot,
}

/// A player's own kit design already placed in the room (ADR-0087 decision
/// 7, ADR-0088; the sim's `DesignerObject`): numbers only. A floor object
/// stands on its turned footprint and, if it is a workstation, keeps its
/// seat's square free like a desk's chair; a desk-top object takes a slot
/// of an existing desk and no floor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExistingObject {
    /// The sim's id (`object-3`).
    pub id: String,
    pub x_mm: i32,
    pub z_mm: i32,
    #[serde(default)]
    pub rot: u8,
    /// `[w, d]` at turn 0, mm (studs × 62.5, rounded up).
    pub footprint_mm: [i32; 2],
    #[serde(default)]
    pub workstation: bool,
    /// The seat relative to the centre at turn 0, mm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_at_mm: Option<[i32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_desk: Option<ObjectOnDesk>,
    #[serde(default)]
    pub seats: u8,
    #[serde(default)]
    pub lights: u8,
    /// Shelf area, stud².
    #[serde(default)]
    pub storage: u32,
    #[serde(default)]
    pub screens: u8,
}

/// The sim's `CHAIR_HALF_MM`: half the side of the square a desk's chair and
/// a workstation object's seat keep free.
pub const CHAIR_HALF_MM: i32 = 250;

/// `offset` turned `rot` quarter turns clockwise seen from above (the sim's
/// `objects::turn_offset`).
pub const fn turn_offset(offset: [i32; 2], rot: u8) -> [i32; 2] {
    let [x, z] = offset;
    match rot % 4 {
        0 => [x, z],
        1 => [-z, x],
        2 => [-x, -z],
        _ => [z, -x],
    }
}

impl ExistingObject {
    pub fn pos(&self) -> Pos {
        Pos::new(self.x_mm, self.z_mm)
    }

    /// On the floor (not on a desk).
    pub fn is_floor(&self) -> bool {
        self.on_desk.is_none()
    }

    /// A floor workstation: a home for staff, with a seat.
    pub fn is_workstation(&self) -> bool {
        self.is_floor() && self.workstation && self.seat_at_mm.is_some()
    }

    /// Its turned footprint, rounded outward to whole millimetres (never
    /// smaller than the sim's).
    pub fn rect(&self) -> Rect {
        let [w, d] = self.footprint_mm;
        let (w, d) = if self.rot & 1 == 0 { (w, d) } else { (d, w) };
        Rect::around(self.pos(), (w + 1) / 2, (d + 1) / 2)
    }

    /// Where a person sits at it, if it is a workstation.
    pub fn seat(&self) -> Option<Pos> {
        if !self.is_workstation() {
            return None;
        }
        let [dx, dz] = turn_offset(self.seat_at_mm?, self.rot);
        Some(Pos::new(self.x_mm + dx, self.z_mm + dz))
    }

    /// The floor it takes, as the sim judges it: its footprint and its
    /// seat's square. None for a desk-top object.
    pub fn floor_rects(&self) -> Vec<Rect> {
        if !self.is_floor() {
            return Vec::new();
        }
        let mut v = vec![self.rect()];
        if let Some(s) = self.seat() {
            v.push(Rect::around(s, CHAIR_HALF_MM, CHAIR_HALF_MM));
        }
        v
    }
}

/// The room the designer plans for: the sim's room in millimetres (the shape
/// of `layout_json`'s rooms, integers). `doors` are every door in the room's
/// walls, including doors other rooms declare into it; `windows` only those
/// that still face outside (`Room::has_daylight`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Room {
    pub kind: RoomKind,
    pub x_mm: i32,
    pub z_mm: i32,
    pub w_mm: i32,
    pub d_mm: i32,
    #[serde(default)]
    pub doors: Vec<Opening>,
    #[serde(default)]
    pub windows: Vec<Opening>,
    #[serde(default)]
    pub equipment: Vec<ExistingItem>,
    /// The players' own designs in the room.
    #[serde(default)]
    pub objects: Vec<ExistingObject>,
}

impl Room {
    /// The room's rect (wall outer lines).
    pub fn rect(&self) -> Rect {
        Rect {
            x0: self.x_mm,
            z0: self.z_mm,
            x1: self.x_mm + self.w_mm,
            z1: self.z_mm + self.d_mm,
        }
    }

    /// The floor inside the walls.
    pub fn inner(&self) -> Rect {
        self.rect().inflate(-WALL_MM)
    }

    pub fn centre(&self) -> Pos {
        Pos::new(self.x_mm + self.w_mm / 2, self.z_mm + self.d_mm / 2)
    }

    /// The room's extent along a wall: `(start, end)` in x for north and south
    /// walls, in z for east and west walls.
    pub fn along(&self, side: Side) -> (i32, i32) {
        if side.runs_along_x() {
            (self.x_mm, self.x_mm + self.w_mm)
        } else {
            (self.z_mm, self.z_mm + self.d_mm)
        }
    }

    /// An opening's span along its wall, absolute millimetres.
    pub fn span(&self, o: &Opening) -> (i32, i32) {
        let (start, _) = self.along(o.side);
        (start + o.at_mm, start + o.at_mm + o.width_mm)
    }

    /// The clear zone in front of a door.
    pub fn door_zone(&self, o: &Opening) -> Rect {
        let (a, b) = self.span(o);
        let r = self.rect();
        match o.side {
            Side::North => Rect::new(a, r.z0, b, r.z0 + DOOR_CLEAR_DEPTH_MM),
            Side::South => Rect::new(a, r.z1 - DOOR_CLEAR_DEPTH_MM, b, r.z1),
            Side::West => Rect::new(r.x0, a, r.x0 + DOOR_CLEAR_DEPTH_MM, b),
            Side::East => Rect::new(r.x1 - DOOR_CLEAR_DEPTH_MM, a, r.x1, b),
        }
    }

    /// The window's opening as a segment on the wall line.
    pub fn window_segment(&self, o: &Opening) -> Rect {
        let (a, b) = self.span(o);
        let r = self.rect();
        match o.side {
            Side::North => Rect::new(a, r.z0, b, r.z0),
            Side::South => Rect::new(a, r.z1, b, r.z1),
            Side::West => Rect::new(r.x0, a, r.x0, b),
            Side::East => Rect::new(r.x1, a, r.x1, b),
        }
    }

    pub fn existing(&self, id: &str) -> Option<&ExistingItem> {
        self.equipment.iter().find(|e| e.id == id)
    }

    pub fn object(&self, id: &str) -> Option<&ExistingObject> {
        self.objects.iter().find(|o| o.id == id)
    }

    /// People the room holds (`Room::capacity`).
    pub fn capacity(&self) -> i64 {
        let tiles = i64::from(self.w_mm / TILE_MM) * i64::from(self.d_mm / TILE_MM);
        (tiles / self.kind.tiles_per_person()).max(1)
    }

    /// Seats at the table, if the room holds one (the sim's `table_size`).
    pub fn table_seats(&self) -> usize {
        if self.kind.holds_table() {
            usize::try_from(self.capacity())
                .unwrap_or(0)
                .min(TABLE_SEATS.len())
        } else {
            0
        }
    }

    /// The table's seat positions (the sim's `table_seat`).
    pub fn table_seat_positions(&self) -> Vec<Pos> {
        let c = self.centre();
        let hx = (self.w_mm / 2 - TABLE_SEAT_WALL_MM).max(0);
        let hz = (self.d_mm / 2 - TABLE_SEAT_WALL_MM).max(0);
        TABLE_SEATS
            .iter()
            .take(self.table_seats())
            .map(|(dx, dz)| Pos::new(c.x + (*dx).clamp(-hx, hx), c.z + (*dz).clamp(-hz, hz)))
            .collect()
    }
}

// ------------------------------------------------------------------ geometry

/// A point on the floor, millimetres.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
pub struct Pos {
    pub x: i32,
    pub z: i32,
}

impl Pos {
    pub const fn new(x: i32, z: i32) -> Pos {
        Pos { x, z }
    }

    pub fn chebyshev(self, o: Pos) -> i32 {
        (self.x - o.x).abs().max((self.z - o.z).abs())
    }
}

/// Where a desk's chair stands (`sim_core::equipment::seat_pos`).
pub const fn seat_pos(pos: Pos, rot: u8) -> Pos {
    let (dx, dz) = match rot % 4 {
        0 => (0, SEAT_OFFSET_MM),
        1 => (-SEAT_OFFSET_MM, 0),
        2 => (0, -SEAT_OFFSET_MM),
        _ => (SEAT_OFFSET_MM, 0),
    };
    Pos::new(pos.x + dx, pos.z + dz)
}

/// An axis-aligned rectangle, millimetres; `x0 ≤ x1`, `z0 ≤ z1`. Rects that
/// only touch do not intersect.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Rect {
    pub x0: i32,
    pub z0: i32,
    pub x1: i32,
    pub z1: i32,
}

impl Rect {
    pub const fn new(x0: i32, z0: i32, x1: i32, z1: i32) -> Rect {
        Rect { x0, z0, x1, z1 }
    }

    pub const fn around(p: Pos, hx: i32, hz: i32) -> Rect {
        Rect::new(p.x - hx, p.z - hz, p.x + hx, p.z + hz)
    }

    pub const fn intersects(&self, o: &Rect) -> bool {
        self.x0 < o.x1 && o.x0 < self.x1 && self.z0 < o.z1 && o.z0 < self.z1
    }

    /// Overlap widths `(x, z)`; zero or negative when apart.
    pub fn overlap(&self, o: &Rect) -> (i32, i32) {
        (
            self.x1.min(o.x1) - self.x0.max(o.x0),
            self.z1.min(o.z1) - self.z0.max(o.z0),
        )
    }

    pub const fn inflate(&self, n: i32) -> Rect {
        Rect::new(self.x0 - n, self.z0 - n, self.x1 + n, self.z1 + n)
    }

    pub const fn contains_rect(&self, o: &Rect) -> bool {
        o.x0 >= self.x0 && o.z0 >= self.z0 && o.x1 <= self.x1 && o.z1 <= self.z1
    }

    /// Strictly inside (a point on the edge is outside).
    pub const fn contains_strict(&self, p: Pos) -> bool {
        p.x > self.x0 && p.x < self.x1 && p.z > self.z0 && p.z < self.z1
    }

    pub fn union(&self, o: &Rect) -> Rect {
        Rect::new(
            self.x0.min(o.x0),
            self.z0.min(o.z0),
            self.x1.max(o.x1),
            self.z1.max(o.z1),
        )
    }

    pub fn centre(&self) -> Pos {
        Pos::new(
            self.x0 + (self.x1 - self.x0) / 2,
            self.z0 + (self.z1 - self.z0) / 2,
        )
    }

    /// The span along x (`true`) or z.
    pub const fn span(&self, along_x: bool) -> (i32, i32) {
        if along_x {
            (self.x0, self.x1)
        } else {
            (self.z0, self.z1)
        }
    }

    /// Squared Euclidean distance from a point to the rect (0 inside).
    pub fn dist2(&self, p: Pos) -> i64 {
        let dx = i64::from((self.x0 - p.x).max(p.x - self.x1).max(0));
        let dz = i64::from((self.z0 - p.z).max(p.z - self.z1).max(0));
        dx * dx + dz * dz
    }

    /// Chebyshev distance from a point to the rect (0 inside).
    pub fn chebyshev(&self, p: Pos) -> i32 {
        let dx = (self.x0 - p.x).max(p.x - self.x1).max(0);
        let dz = (self.z0 - p.z).max(p.z - self.z1).max(0);
        dx.max(dz)
    }
}

// ------------------------------------------------------------------ text

/// Millimetres as metres for messages: `1.25 m`, `0.5 m`, `3 m`.
pub fn fmt_m(mm: i64) -> String {
    let sign = if mm < 0 { "-" } else { "" };
    let mm = mm.abs();
    let cm = (mm + 5) / 10;
    let (m, rest) = (cm / 100, cm % 100);
    if rest == 0 {
        format!("{sign}{m} m")
    } else if rest % 10 == 0 {
        format!("{sign}{m}.{} m", rest / 10)
    } else {
        format!("{sign}{m}.{rest:02} m")
    }
}

/// Cents as money for messages: `€400.00`.
pub fn fmt_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let c = cents.abs();
    format!("{sign}€{}.{:02}", c / 100, c % 100)
}

/// Rounds `v` to the [`GRID_MM`] grid, up (`true`) or down.
pub const fn snap(v: i32, up: bool) -> i32 {
    let q = v.div_euclid(GRID_MM) * GRID_MM;
    if up && q < v {
        q + GRID_MM
    } else {
        q
    }
}

/// Rounds `v` to the grid toward `target`.
pub const fn snap_toward(v: i32, target: i32) -> i32 {
    snap(v, v < target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units() {
        assert_eq!(studs_mm(16), 1000);
        assert_eq!(studs_mm(1), 63);
        assert_eq!(studs_mm(8), 500);
        assert_eq!(half_studs_mm(24), 750);
        assert_eq!(half_studs_mm(7), 219);
        assert_eq!(fmt_m(1250), "1.25 m");
        assert_eq!(fmt_m(500), "0.5 m");
        assert_eq!(fmt_m(3000), "3 m");
        assert_eq!(fmt_m(-62), "-0.06 m");
        assert_eq!(fmt_cents(40_000), "€400.00");
        assert_eq!(snap(130, true), 250);
        assert_eq!(snap(130, false), 125);
        assert_eq!(snap(-130, false), -250);
        assert_eq!(snap_toward(1010, 5000), 1125);
        assert_eq!(snap_toward(1010, 0), 1000);
    }

    #[test]
    fn sides_and_turns() {
        for s in Side::ALL {
            assert_eq!(Side::of_rot(s.front_rot()), s);
            assert_eq!(Side::from_slug(s.slug()), Some(s));
        }
        // the chair stands on the front side
        let p = Pos::new(0, 0);
        for s in Side::ALL {
            let seat = seat_pos(p, s.front_rot());
            let (dx, dz) = s.delta();
            assert_eq!(seat, Pos::new(dx * SEAT_OFFSET_MM, dz * SEAT_OFFSET_MM));
        }
    }

    #[test]
    fn rects() {
        let a = Rect::new(0, 0, 10, 10);
        assert!(!a.intersects(&Rect::new(10, 0, 20, 10)));
        assert!(a.intersects(&Rect::new(9, 9, 20, 20)));
        assert_eq!(a.overlap(&Rect::new(5, 8, 20, 20)), (5, 2));
        assert_eq!(a.dist2(Pos::new(13, 14)), 9 + 16);
        assert_eq!(a.chebyshev(Pos::new(13, 14)), 4);
    }
}
