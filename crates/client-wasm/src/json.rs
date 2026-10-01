//! JSON views for the TypeScript client until it has a postcard decoder.
//!
//! Units: sim-core works in millimetres; these views convert to metres (the
//! renderer's unit) here at the boundary. Ids are strings (`room-1`,
//! `equip-7`, `staff-3`) so they can key JS objects.

use serde_json::{json, Map, Value};
use sim_core::building::Building;
use sim_core::economy::REVENUE_IS_STUB;
use sim_core::equipment::{DeviceState, EquipmentKind};
use sim_core::finance::CostBreakdown;
use sim_core::geom::PosMm;
use sim_core::ids::{PersonaId, StaffId};
use sim_core::inbox::TicketKind;
use sim_core::projects::{ProjectStatus, MONTH_DAYS};
use sim_core::render_state::{Light, RenderState};
use sim_core::roles::Department;
use sim_core::staff::{persona, persona_slug, Spot, Staff};
use sim_core::World;

/// Wall height in metres (single storey in M1).
pub const WALL_HEIGHT_M: f64 = 3.0;

/// Millimetres → metres. The only float math in the client facade.
#[allow(clippy::float_arithmetic)]
pub fn m(mm: i32) -> f64 {
    f64::from(mm) / 1000.0
}

/// Quarter turns → radians (clockwise seen from above, 0 = chair south).
#[allow(clippy::float_arithmetic)]
pub fn radians(rot: u8) -> f64 {
    f64::from(rot % 4) * std::f64::consts::FRAC_PI_2
}

fn tiles(t: i32) -> f64 {
    m(t * sim_core::geom::TILE_MM)
}

fn phase_slug(p: sim_core::DayPhase) -> &'static str {
    use sim_core::DayPhase::*;
    match p {
        Night => "night",
        Arrival => "arrival",
        Standup => "standup",
        Work => "work",
        Lunch => "lunch",
        Evening => "evening",
    }
}

fn weekday_slug(d: sim_core::clock::Weekday) -> &'static str {
    use sim_core::clock::Weekday::*;
    match d {
        Monday => "monday",
        Tuesday => "tuesday",
        Wednesday => "wednesday",
        Thursday => "thursday",
        Friday => "friday",
        Saturday => "saturday",
        Sunday => "sunday",
    }
}

fn state_slug(s: DeviceState) -> &'static str {
    match s {
        DeviceState::Off => "off",
        DeviceState::On => "on",
        DeviceState::InUse(_) => "in-use",
    }
}

fn point(p: PosMm) -> Value {
    json!([m(p.x), m(p.z)])
}

/// Building layout in the shape of the TS `BuildingLayout`
/// (`apps/game/src/state/render-state.ts`), plus doors, entrance and props.
pub fn layout(b: &Building) -> Value {
    let rooms: Vec<Value> = b
        .rooms
        .values()
        .map(|r| {
            let items = b.equipment.values().filter(|e| e.room == r.id);
            let mut desks = Vec::new();
            let mut lights = Vec::new();
            let mut props = Vec::new();
            for e in items {
                match e.kind {
                    EquipmentKind::Desk => desks.push(json!({
                        "id": e.id.to_string(),
                        "x": m(e.pos.x),
                        "z": m(e.pos.z),
                        "rot": radians(e.rot),
                        "seat": point(e.seat_pos()),
                    })),
                    EquipmentKind::CeilingLight => lights.push(json!({
                        "id": e.id.to_string(),
                        "x": m(e.pos.x),
                        "z": m(e.pos.z),
                    })),
                    kind => props.push(json!({
                        "id": e.id.to_string(),
                        "kind": kind.slug(),
                        "x": m(e.pos.x),
                        "z": m(e.pos.z),
                        "rot": radians(e.rot),
                        "attachedTo": e.attached_to.map(|d| d.to_string()),
                    })),
                }
            }
            json!({
                "id": r.id.to_string(),
                "kind": r.kind.slug(),
                "label": r.kind.label(),
                "x": tiles(r.rect.x),
                "z": tiles(r.rect.z),
                "w": tiles(r.rect.w),
                "d": tiles(r.rect.d),
                "floor": r.floor,
                "level": r.level,
                "capacity": r.capacity(),
                "windows": r.windows.iter().map(|w| json!({
                    "side": w.side.slug(),
                    "at": m(w.at_mm),
                    "width": m(w.width_mm),
                })).collect::<Vec<_>>(),
                "doors": r.doors.iter().map(|d| json!({
                    "side": d.side.slug(),
                    "at": tiles(d.at),
                    "width": 1.0,
                })).collect::<Vec<_>>(),
                "desks": desks,
                "ceilingLights": lights,
                "props": props,
            })
        })
        .collect();
    let e = b.entrance;
    // Centre of the entrance door on the lot boundary.
    let c = e.tile.center();
    let (dx, dz) = e.side.delta();
    let door = PosMm::new(
        c.x + dx * sim_core::geom::HALF_TILE_MM,
        c.z + dz * sim_core::geom::HALF_TILE_MM,
    );
    json!({
        "originX": tiles(b.lot.x),
        "originZ": tiles(b.lot.z),
        "width": tiles(b.lot.w),
        "depth": tiles(b.lot.d),
        "wallHeight": WALL_HEIGHT_M,
        "floors": b.floors,
        "entrance": {
            "side": e.side.slug(),
            "x": m(door.x),
            "z": m(door.z),
            "spawn": point(b.spawn_pos()),
        },
        "rooms": rooms,
    })
}

/// Render state in the shape of the TS `RenderState` (minute, day,
/// roomLights, monitors, deskLamps, staff[]) plus the richer sim fields.
pub fn render_state(w: &World, rs: &RenderState) -> Value {
    let mut room_lights = Map::new();
    let rooms: Vec<Value> = rs
        .rooms
        .iter()
        .map(|r| {
            room_lights.insert(r.id.to_string(), Value::Bool(r.light != Light::Off));
            json!({
                "id": r.id.to_string(),
                "kind": r.kind.slug(),
                "light": r.light.slug(),
                "occupancy": r.occupancy,
                "capacity": r.capacity,
            })
        })
        .collect();

    let mut monitors = Map::new();
    let mut lamps = Map::new();
    let devices: Vec<Value> = rs
        .devices
        .iter()
        .map(|d| {
            let on = d.state != DeviceState::Off;
            if let Some(desk) = d.attached_to {
                match d.kind {
                    EquipmentKind::Monitor | EquipmentKind::ColorMonitor => {
                        monitors.insert(desk.to_string(), Value::Bool(on));
                    }
                    EquipmentKind::DeskLamp => {
                        lamps.insert(desk.to_string(), Value::Bool(on));
                    }
                    _ => {}
                }
            }
            json!({
                "id": d.id.to_string(),
                "room": d.room.to_string(),
                "kind": d.kind.slug(),
                "state": state_slug(d.state),
                "user": match d.state {
                    DeviceState::InUse(s) => Value::String(s.to_string()),
                    _ => Value::Null,
                },
                "attachedTo": d.attached_to.map(|a| a.to_string()),
            })
        })
        .collect();

    let staff: Vec<Value> = rs
        .staff
        .iter()
        .map(|s| {
            let meeting = w.staff.get(&s.id).and_then(|st| match st.spot {
                Some(Spot::MeetingSeat { meeting, .. }) => Some(meeting.to_string()),
                _ => None,
            });
            json!({
                "id": s.id.to_string(),
                "persona": persona_slug(s.persona),
                "name": persona_name(s.persona),
                "color": persona_color(s.persona),
                "role": s.role.slug(),
                "department": s.role.department().slug(),
                "x": m(s.pos_mm.x),
                "z": m(s.pos_mm.z),
                "pose": s.pose.slug(),
                "activity": s.activity.slug(),
                "seatedAt": s.seated_at.map(|d| d.to_string()),
                "meeting": meeting,
                "fatigue": s.fatigue,
                "morale": s.morale,
                "path": s.path.as_ref().map(|path| json!({
                    "waypoints": path.waypoints.iter().map(|p| point(*p)).collect::<Vec<_>>(),
                    "startStep": path.start_step,
                    "speed": m(path.speed_mm_per_step),
                })),
            })
        })
        .collect();

    let meetings: Vec<Value> = w
        .meetings
        .values()
        .map(|m| {
            json!({
                "id": m.id.to_string(),
                "kind": m.kind.slug(),
                "project": opt_id(m.project),
                "room": m.room.to_string(),
                "day": m.day,
                "start": m.start,
                "end": m.end,
                "active": m.is_active(w.clock()),
                "attendees": m.attendees.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                "speaker": opt_id(m.speaker),
            })
        })
        .collect();

    json!({
        "step": rs.step,
        "weekday": weekday_slug(w.clock().weekday()),
        "meetings": meetings,
        "day": rs.day,
        "minute": rs.minute,
        "phase": phase_slug(rs.phase),
        "daylight": rs.daylight,
        "cashCents": rs.cash_cents,
        "roomLights": room_lights,
        "monitors": monitors,
        "deskLamps": lamps,
        "rooms": rooms,
        "devices": devices,
        "staff": staff,
    })
}

// ----------------------------------------------------------------------
// Organization views (docs/game-design/organization.md §9)
// ----------------------------------------------------------------------

/// Cents → euros. Float math only here, at the boundary.
#[allow(clippy::float_arithmetic, clippy::cast_precision_loss)]
pub fn eur(cents: i64) -> f64 {
    cents as f64 / 100.0
}

/// Permille → 0..1.
#[allow(clippy::float_arithmetic)]
pub fn unit(pm: u16) -> f64 {
    f64::from(pm) / 1000.0
}

/// Daily salary in cents → euros per month (30 game days), whole euros.
pub fn salary_eur_month(cents_per_day: i64) -> i64 {
    (cents_per_day * i64::from(MONTH_DAYS) + 50) / 100
}

/// Display name of a persona, falling back to its slug.
fn persona_name(id: PersonaId) -> String {
    persona(id).map_or_else(|| persona_slug(id), |p| p.name.to_string())
}

fn persona_color(id: PersonaId) -> String {
    format!("#{:06x}", persona(id).map_or(0x7f7f7f, |p| p.color))
}

fn opt_id<T: ToString>(id: Option<T>) -> Value {
    id.map_or(Value::Null, |i| Value::String(i.to_string()))
}

/// Who heads a department: highest role rank, then seniority, then salary,
/// then the longest-serving (lowest id).
fn department_head(members: &[&Staff]) -> Option<StaffId> {
    members
        .iter()
        .max_by_key(|s| {
            (
                s.role.head_rank(),
                s.seniority,
                s.salary,
                std::cmp::Reverse(s.id),
            )
        })
        .map(|s| s.id)
}

/// `Sim.org_json()`: the org chart, people and projects.
pub fn org(w: &World) -> Value {
    let active: Vec<&Staff> = w.staff.values().filter(|s| s.is_active()).collect();
    let departments: Vec<Value> = Department::ALL
        .iter()
        .map(|d| {
            let members: Vec<&Staff> = active
                .iter()
                .copied()
                .filter(|s| s.department() == *d)
                .collect();
            json!({
                "id": d.slug(),
                "name": d.name(),
                "head": opt_id(department_head(&members)),
                "members": members.iter().map(|s| s.id.to_string()).collect::<Vec<_>>(),
            })
        })
        .collect();
    let staff: Vec<Value> = active
        .iter()
        .map(|s| {
            json!({
                "id": s.id.to_string(),
                "persona": persona_slug(s.persona),
                "name": persona_name(s.persona),
                "role": s.role.slug(),
                "department": s.department().slug(),
                "seniority": s.seniority.slug(),
                "salaryEurMonth": salary_eur_month(s.salary),
                "morale": unit(s.morale),
                "fatigue": unit(s.fatigue),
                "activity": s.activity.slug(),
                "projects": s.projects.iter().map(|(p, pct)| json!({
                    "project": p.to_string(),
                    "allocation": pct,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let projects: Vec<Value> = w
        .projects
        .values()
        .map(|p| {
            let week = p.analytics.window(7);
            json!({
                "id": p.id.to_string(),
                "slug": p.slug,
                "name": p.name,
                "domain": p.domain,
                "repo": p.repo,
                "status": p.status.slug(),
                "lead": opt_id(p.lead),
                "team": w.project_team(p.id).iter().map(|(s, pct)| json!({
                    "staff": s.to_string(),
                    "allocation": pct,
                })).collect::<Vec<_>>(),
                "budgetEurMonth": eur(p.budget_monthly_cents),
                "missingRoles": if p.status == ProjectStatus::Active {
                    w.missing_roles(p.id).iter().map(|r| r.slug()).collect::<Vec<_>>()
                } else {
                    Vec::new()
                },
                "kpis": {
                    "livePages": p.kpis.live_pages,
                    "audience": p.kpis.audience,
                    "goalMonthlyReaders": p.kpis.goal_monthly_readers,
                    "goalProgress": unit(p.kpis.goal_progress_pm),
                },
                "analytics": {
                    "connected": p.analytics.connected(),
                    "sessions7d": week.sessions,
                    "visitors7d": week.visitors,
                    "pageviews7d": week.pageviews,
                    "engagementRate": unit(week.engagement_pm),
                },
            })
        })
        .collect();
    json!({
        "ceo": { "name": "You" },
        "executive": {
            "cfo": opt_id(w.exec.cfo),
            "secretary": opt_id(w.exec.secretary),
            "delegation": w.exec.delegation.slug(),
        },
        "departments": departments,
        "staff": staff,
        "projects": projects,
    })
}

fn breakdown(c: &CostBreakdown) -> Value {
    json!({
        "revenueEur": eur(c.revenue),
        "salariesEur": eur(c.salaries),
        "overtimeEur": eur(c.overtime),
        "rentEur": eur(c.rent),
        "upkeepEur": eur(c.upkeep),
        "agencyEur": eur(c.agency),
    })
}

/// Ticket kinds the finance panel lists as CFO alerts.
const ALERT_KINDS: [TicketKind; 4] = [
    TicketKind::BudgetOverrun,
    TicketKind::RunwayLow,
    TicketKind::PayrollSpike,
    TicketKind::LoanOffer,
];

/// `Sim.finance_json()`: cash, runway, this month's books and CFO alerts.
pub fn finance(w: &World) -> Value {
    let f = &w.finance;
    let projects: Vec<Value> = w
        .projects
        .values()
        .filter(|p| p.is_open())
        .map(|p| {
            json!({
                "id": p.id.to_string(),
                "name": p.name,
                "budgetEurMonth": eur(p.budget_monthly_cents),
                "spentEurMonth": eur(p.ledger.month.spent()),
                "revenueEurMonth": eur(p.ledger.month.revenue),
                "revenueEstimateEurMonth": eur(p.ledger.revenue_estimate_month),
                "overBudget": w.project_over_budget(p.id),
                "month": breakdown(&p.ledger.month),
            })
        })
        .collect();
    let alerts: Vec<Value> = w
        .tickets
        .values()
        .filter(|t| t.is_open() && ALERT_KINDS.contains(&t.kind))
        .map(|t| {
            json!({
                "kind": t.kind.slug(),
                "project": opt_id(t.project),
                "ticket": t.id.to_string(),
            })
        })
        .collect();
    let last_close = f.closes.last().map(|c| {
        json!({
            "month": c.month,
            "firstDay": c.first_day,
            "lastDay": c.last_day,
            "company": breakdown(&c.company),
            "otherEur": eur(c.other_cents),
            "loanNetEur": eur(c.loan_net_cents),
            "overhead": breakdown(&c.overhead),
            "projects": c.projects.iter().map(|p| json!({
                "id": p.project.to_string(),
                "budgetEurMonth": eur(p.budget_cents),
                "spentEurMonth": eur(p.spent_cents),
                "revenueEurMonth": eur(p.revenue_cents),
                "revenueEstimateEurMonth": eur(p.revenue_estimate_cents),
                "overBudget": p.over_budget,
                "month": breakdown(&p.breakdown),
            })).collect::<Vec<_>>(),
            "cashEndEur": eur(c.cash_end),
            "runwayDays": c.runway_days,
            "booksKept": c.books_kept,
        })
    });
    json!({
        "cashEur": eur(w.company.cash),
        "runwayDays": w.runway_days(),
        "dailyBurnEur": eur(w.daily_burn_cents()),
        "month": f.month,
        "dayOfMonth": f.days_in_month + 1,
        "company": breakdown(&f.company_month),
        "overhead": breakdown(&f.overhead_month),
        "projects": projects,
        "alerts": alerts,
        "booksUnkept": !w.books_kept(),
        "revenueStubbed": REVENUE_IS_STUB,
        "loan": w.company.loan.map(|l| json!({
            "principalEur": eur(l.principal),
            "remainingEur": eur(l.remaining),
            "dailyPaymentEur": eur(l.daily_payment),
        })),
        "lastClose": last_close,
    })
}

/// Absolute game minute (minutes since day 0, 00:00) of a step.
fn minute_of_step(w: &World, step: u64) -> u64 {
    w.config.clock_at(step).total_minutes()
}

/// `Sim.inbox_json()`: tickets and the Secretary's queue.
pub fn inbox(w: &World) -> Value {
    let tickets: Vec<Value> = w
        .tickets
        .values()
        .map(|t| {
            json!({
                "id": t.id.to_string(),
                "kind": t.kind.slug(),
                "priority": t.priority.slug(),
                "project": opt_id(t.project),
                "from": opt_id(t.from),
                "role": t.role.map(|r| r.slug()),
                "amountEur": eur(t.amount_cents),
                "status": t.status.slug(),
                "routedViaSecretary": t.routed_via_secretary,
                "options": t.options.iter().map(|o| o.slug()).collect::<Vec<_>>(),
                "defaultOption": t.default_option.slug(),
                "proposedOption": t.proposed_option.map(|o| o.slug()),
                "replyDrafted": t.reply_drafted,
                "answer": t.answer.map(|o| o.slug()),
                "resolvedBy": t.resolved_by.map(|r| r.slug()),
                "createdMinute": minute_of_step(w, t.created_step),
                "deadlineMinute": minute_of_step(w, t.deadline_step),
                "deadlineStep": t.deadline_step,
            })
        })
        .collect();
    let queue: Vec<Value> = w
        .secretary_tasks
        .values()
        .map(|t| {
            json!({
                "id": t.id.to_string(),
                "kind": t.kind.slug(),
                "status": t.status.slug(),
                "dueMinute": t.due_step.map(|s| minute_of_step(w, s)),
            })
        })
        .collect();
    json!({
        "delegation": w.exec.delegation.slug(),
        "secretary": opt_id(w.exec.secretary),
        "tickets": tickets,
        "secretaryQueue": queue,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_conversion() {
        assert_eq!(m(2_500), 2.5);
        assert_eq!(radians(0), 0.0);
        assert_eq!(radians(2), std::f64::consts::PI);
        assert_eq!(eur(9_290_009), 92_900.09);
        assert_eq!(unit(710), 0.71);
        assert_eq!(salary_eur_month(14_000), 4_200);
        assert_eq!(salary_eur_month(13_333), 4_000);
    }
}
