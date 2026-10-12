//! The office designer's jobs (ADR-0087 decision 6, FEAT-084): a room plan
//! drafted by relation and built by the sim at the CEO's word.
//!
//! ```text
//! CommissionInterior{room, brief_ref}  the host stores {words, brief} under
//!                                      brief_ref ([`interior_brief`]) and logs the command
//! InteriorDesign (Draft, Interior)     the room from the host (`context.room`,
//!                                      `Sim.interior_context_json`) + the brief
//!   → office_designer::layout_context + plan_schema(slice, room)
//!   → one structured call `office layout` (one schema repair turn): a Plan
//!   → evaluate (solve + checks) → next_step:
//!       Repair{fix, issues} → `office layout fix` (fix_schema) → apply_fix → evaluate …
//!       (at most office_designer::MAX_REPAIR_ROUNDS)
//!       GiveUp → a status post with the issues, JobFailed{InvalidOutput}
//!       Done, no items → a status post (nothing to build), JobFailed{InvalidOutput}
//!       Done   → the item's artifact: RoomPlan{room, items in build order, cost, parts,
//!                summary, warnings}, an `artifact` post with the summary
//!                → InteriorPlan{job_id, items} (the placements, numbers only)
//!                → JobCompleted{ok, score: min(items, 10), qa_defects: repair rounds}
//!   a model failure → a status post, JobFailed (never a fake success, rule 11)
//! Construct (Publish, after Build)    the sim places the items itself (sim-core
//!   `interior`); the job reports the build in the thread → JobCompleted{ok}
//! ```
//!
//! The orchestrator never places anything: the sim validates every item
//! again when its turn comes (rule 3), and a refused one stops the build.

use agents::build::{fix_prompt, layout_prompt, LayoutInput, FIX_ANSWER, LAYOUT_ANSWER};
use agents::prompts::templates;
use agents::{LlmError, RepairFailed};
use office_designer::model::fmt_cents;
use office_designer::{
    apply_fix, evaluate, fix_schema, layout_context, next_step, plan_schema, slice, At, Catalogue,
    DeskRef, Evaluation, Issue, Plan, PlanFix, Room, Step, MAX_REPAIR_ROUNDS,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::run::{corrupt, invalid, Orchestrator, Result};
use crate::staged::stage_hash;
use crate::store::Store;
use crate::structure::failure;
use crate::{
    Digest, Gateway, JobRequest, Outcome, PlannedAtOut, PlannedItemOut, PosOut, ProgressState,
    StaffRef,
};

/// `RoomPlan.kind`.
pub const ROOM_PLAN_KIND: &str = "room-plan";

/// The brief record a host stores when the CEO commissions a room: the
/// CEO's words and the office designer's brief (`office_designer::Brief`).
pub fn interior_brief(words: &str, brief: &Value) -> Value {
    json!({ "words": words.trim(), "brief": brief })
}

/// The desk an item of a room plan goes on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnDesk {
    /// A desk of this plan: its index in `RoomPlan.items`.
    Planned(usize),
    /// A desk already in the room (`equip-3`).
    Existing(String),
}

/// One item of a room plan, in build order: a floor item at `x_mm, z_mm`
/// turned `rot` quarter turns, or an attachment `on_desk` (position 0).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomPlanItem {
    /// The sim's equipment slug (`desk`, `desk-lamp`).
    pub design: String,
    pub x_mm: i32,
    pub z_mm: i32,
    pub rot: u8,
    pub on_desk: Option<OnDesk>,
}

/// The office designer's artifact: what the CEO approves and the sim builds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoomPlan {
    /// [`ROOM_PLAN_KIND`].
    pub kind: String,
    /// The sim's room id (`room-6`).
    pub room: String,
    /// In build order (the solver's order: a desk before what goes on it).
    pub items: Vec<RoomPlanItem>,
    /// The sim's price of every item, cents.
    pub cost_cents: i64,
    /// Kit parts the plan adds.
    pub parts: u32,
    /// One line for the CEO.
    pub summary: String,
    /// The checker's warnings: what the room already had wrong (`{id, code,
    /// severity: "warning", message}`); a plan with errors is never stored.
    pub issues: Vec<Issue>,
    /// The plan by relation, as the model wrote it (after its repairs).
    #[serde(default)]
    pub plan: Value,
    /// The brief it was made for.
    #[serde(default)]
    pub brief: Value,
    /// Repair rounds it took.
    #[serde(default)]
    pub repairs: u8,
}

impl RoomPlan {
    /// The placements as the sim's `InteriorPlan` takes them.
    pub fn sim_items(&self) -> Result<Vec<PlannedItemOut>> {
        self.items
            .iter()
            .map(|i| {
                let at = match &i.on_desk {
                    None => PlannedAtOut::Floor {
                        pos: PosOut {
                            x: i.x_mm,
                            z: i.z_mm,
                        },
                        rot: i.rot,
                    },
                    Some(OnDesk::Planned(n)) => PlannedAtOut::OnPlanned(
                        u16::try_from(*n).map_err(|_| invalid("a desk index past u16"))?,
                    ),
                    Some(OnDesk::Existing(id)) => PlannedAtOut::OnDesk(id.clone()),
                };
                Ok(PlannedItemOut {
                    kind: variant_name(&i.design),
                    at,
                })
            })
            .collect()
    }
}

/// `desk-lamp` → `DeskLamp` (the sim's `EquipmentKind` variant names).
fn variant_name(slug: &str) -> String {
    slug.split('-')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect::<String>())
                .unwrap_or_default()
        })
        .collect()
}

/// The solved items as a room plan's items: an attachment on a planned desk
/// names the desk's index in the list.
fn plan_items(eval: &Evaluation) -> Vec<RoomPlanItem> {
    eval.items
        .iter()
        .map(|it| {
            let design = it.design.slug().to_string();
            match &it.at {
                At::Floor { x_mm, z_mm, rot } => RoomPlanItem {
                    design,
                    x_mm: *x_mm,
                    z_mm: *z_mm,
                    rot: *rot,
                    on_desk: None,
                },
                At::OnDesk { desk } => {
                    let on = match desk {
                        DeskRef::Planned { placement, copy } => OnDesk::Planned(
                            eval.items
                                .iter()
                                .position(|d| d.placement == *placement && d.copy == *copy)
                                .unwrap_or(usize::MAX),
                        ),
                        DeskRef::Existing { id } => OnDesk::Existing(id.clone()),
                    };
                    RoomPlanItem {
                        design,
                        x_mm: 0,
                        z_mm: 0,
                        rot: 0,
                        on_desk: Some(on),
                    }
                }
            }
        })
        .collect()
}

/// `Newsroom (room-6): 3 desk, 3 monitor, 1 plant; €2,150.00, 965 parts.`
fn summary_line(room: &Room, room_id: &str, items: &[RoomPlanItem], eval: &Evaluation) -> String {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for i in items {
        match counts.iter_mut().find(|(d, _)| *d == i.design) {
            Some((_, n)) => *n += 1,
            None => counts.push((i.design.clone(), 1)),
        }
    }
    let list = counts
        .iter()
        .map(|(d, n)| format!("{n} {d}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{} ({room_id}): {list}; {}, {} parts.",
        room.kind.label(),
        fmt_cents(eval.cost_cents),
        eval.parts
    )
}

fn lines(issues: &[Issue]) -> Vec<String> {
    issues.iter().map(Issue::line).collect()
}

/// A failure the check reported, as a [`RepairFailed`] for the failure post.
fn invalid_answer(errors: Vec<String>) -> RepairFailed {
    RepairFailed {
        error: LlmError::InvalidOutput {
            errors,
            answer: None,
        },
        calls: 0,
        repairs: 0,
        no_progress: false,
    }
}

impl<S: Store, G: Gateway> Orchestrator<S, G> {
    /// The room and brief of an interior job.
    async fn interior_inputs(&self, req: &JobRequest) -> Result<(String, Room, Value, String)> {
        let room_id = req.context["room_id"]
            .as_str()
            .ok_or_else(|| {
                invalid(format!(
                    "job {} has no room in its context (the host adds Sim.interior_context_json)",
                    req.job_id
                ))
            })?
            .to_string();
        let room: Room = serde_json::from_value(req.context["room"].clone())
            .map_err(|e| invalid(format!("the room of job {}: {e}", req.job_id)))?;
        let brief_ref = req
            .brief_ref
            .ok_or_else(|| invalid(format!("job {} has no brief_ref", req.job_id)))?;
        let rec = self
            .store
            .get_brief(&req.company_id, brief_ref)
            .await?
            .ok_or_else(|| invalid(format!("unknown brief_ref {brief_ref}")))?;
        let brief = rec["brief"].clone();
        let words = rec["words"].as_str().unwrap_or("").trim().to_string();
        Ok((room_id, room, brief, words))
    }

    /// A plan that could not be made: the issues in the item's thread, the job failed.
    async fn room_plan_failed(
        &self,
        req: &JobRequest,
        item: &str,
        who: &StaffRef,
        f: &RepairFailed,
        why: &str,
    ) -> Result<Vec<Outcome>> {
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        let reason = failure(f)?;
        let errors = f.errors();
        let text = if errors.is_empty() {
            format!("The room plan could not be made: {why}.")
        } else {
            format!(
                "The room plan could not be made: {why}.\n{}",
                errors
                    .iter()
                    .take(8)
                    .map(|e| format!("- {e}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        };
        self.system_post(
            req,
            item,
            "status",
            0,
            &text,
            json!({"room_plan": "failed", "errors": errors}),
        )
        .await?;
        self.report_job(req, Some(who), ProgressState::Failed, json!({"error": why}));
        Ok(self.failed(req, reason))
    }

    /// The `InteriorDesign` job (module docs).
    pub(crate) async fn interior_design(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let who = req
            .staff
            .first()
            .ok_or_else(|| invalid(format!("job {} has nobody to do it", req.job_id)))?
            .clone();
        self.report_job(req, Some(&who), ProgressState::Started, json!({}));
        let (room_id, room, brief_json, words) = self.interior_inputs(req).await?;
        let brief: office_designer::Brief = serde_json::from_value(brief_json.clone())
            .map_err(|e| invalid(format!("the brief of job {}: {e}", req.job_id)))?;
        let title = format!("Interior: {} ({room_id})", room.kind.label());
        self.store
            .set_item_text(&req.company_id, &item, Some(&title), Some(&words))
            .await?;
        let cat = Catalogue::shipped();
        let designs = slice(room.kind, &brief, cat);
        let context = layout_context(&room, &brief, cat);
        let template = templates::office_designer();

        // layout#0
        if let Some(reason) = self.cancelled(req) {
            return Ok(self.failed(req, reason));
        }
        self.report(
            req,
            Some(&who),
            "layout",
            0,
            1,
            ProgressState::Started,
            json!({}),
        );
        let user = layout_prompt(&LayoutInput {
            words: &words,
            brief: &brief_json,
            context: &context,
        });
        let schema = plan_schema(&designs, Some(&room));
        let check = |v: &Value| Plan::from_value(v).map(|_| ()).map_err(|i| lines(&i));
        let answer = self
            .propose(
                req,
                &who,
                &template,
                agents::JobKind::OfficeLayout,
                "office_layout",
                user,
                LAYOUT_ANSWER,
                &schema,
                &check,
            )
            .await?;
        let mut plan = match answer.map(|(v, _)| Plan::from_value(&v)) {
            Ok(Ok(p)) => p,
            Ok(Err(i)) => {
                return self
                    .room_plan_failed(
                        req,
                        &item,
                        &who,
                        &invalid_answer(lines(&i)),
                        "the layout does not parse",
                    )
                    .await
            }
            Err(f) => {
                return self
                    .room_plan_failed(req, &item, &who, &f, "the model gave no layout")
                    .await
            }
        };
        self.report(
            req,
            Some(&who),
            "layout",
            0,
            1,
            ProgressState::Done,
            json!({"placements": plan.placements.len()}),
        );

        // solve, check, fix#i
        let mut round = 0u8;
        let eval = loop {
            if let Some(reason) = self.cancelled(req) {
                return Ok(self.failed(req, reason));
            }
            let eval = evaluate(&room, &plan, &brief, cat);
            match next_step(&eval, round, MAX_REPAIR_ROUNDS) {
                Step::Done => break eval,
                Step::GiveUp { reason, issues } => {
                    let f = invalid_answer(lines(&issues));
                    return self.room_plan_failed(req, &item, &who, &f, &reason).await;
                }
                Step::Repair(task) => {
                    let index = u32::from(task.round);
                    let total = u32::from(MAX_REPAIR_ROUNDS);
                    self.report(
                        req,
                        Some(&who),
                        "fix",
                        index,
                        total,
                        ProgressState::Started,
                        json!({"issues": task.issues.len()}),
                    );
                    let user =
                        fix_prompt(&brief_json, &context, &plan.to_json(), &task.prompt(&plan));
                    let schema = fix_schema(&designs, Some(&room));
                    let check = |v: &Value| {
                        PlanFix::from_json(&v.to_string())
                            .and_then(|f| apply_fix(&plan, &task, &f))
                            .map(|_| ())
                            .map_err(|i| lines(&i))
                    };
                    let stage = format!("office_fix:{}", task.round);
                    let answer = self
                        .propose(
                            req,
                            &who,
                            &template,
                            agents::JobKind::OfficeLayout,
                            &stage,
                            user,
                            FIX_ANSWER,
                            &schema,
                            &check,
                        )
                        .await?;
                    let fixed = match answer {
                        Ok((v, _)) => PlanFix::from_json(&v.to_string())
                            .and_then(|f| apply_fix(&plan, &task, &f)),
                        Err(f) => {
                            return self
                                .room_plan_failed(req, &item, &who, &f, "the model gave no fix")
                                .await
                        }
                    };
                    plan = match fixed {
                        Ok(p) => p,
                        Err(i) => {
                            let f = invalid_answer(lines(&i));
                            return self
                                .room_plan_failed(req, &item, &who, &f, "the fix does not apply")
                                .await;
                        }
                    };
                    self.report(
                        req,
                        Some(&who),
                        "fix",
                        index,
                        total,
                        ProgressState::Done,
                        json!({}),
                    );
                    round = task.round;
                }
            }
        };

        // A plan that places nothing is no room plan: the sim refuses an empty
        // `InteriorPlan`, and the CEO would approve nothing (rule 11).
        if eval.items.is_empty() {
            let f = invalid_answer(Vec::new());
            let why = "the plan places nothing, so there is nothing to build (the room may already have what the brief asks for)";
            return self.room_plan_failed(req, &item, &who, &f, why).await;
        }

        // The artifact: the room plan, as the CEO approves it and the sim builds it.
        let items = plan_items(&eval);
        let warnings: Vec<Issue> = eval
            .issues
            .iter()
            .filter(|i| !i.is_error())
            .cloned()
            .collect();
        let room_plan = RoomPlan {
            kind: ROOM_PLAN_KIND.into(),
            room: room_id.clone(),
            summary: summary_line(&room, &room_id, &items, &eval),
            items,
            cost_cents: eval.cost_cents,
            parts: eval.parts,
            issues: warnings,
            plan: serde_json::to_value(&plan).map_err(corrupt)?,
            brief: brief_json,
            repairs: round,
        };
        let sim_items = room_plan.sim_items()?;
        let sha = stage_hash(&[&serde_json::to_string(&room_plan).map_err(corrupt)?]);
        let mut art = self.load_artifact(req, &item).await?.unwrap_or_default();
        art.brief_ref = req.brief_ref.unwrap_or(art.brief_ref);
        art.revision = req.revision;
        art.model = self.llm.model_id().or(art.model);
        art.room_plan = Some(room_plan.clone());
        self.save_artifact(req, &item, &art).await?;
        let mut text = room_plan.summary.clone();
        if !room_plan.issues.is_empty() {
            text.push_str("\n\nWorth knowing:\n");
            text.push_str(
                &room_plan
                    .issues
                    .iter()
                    .map(|i| format!("- {}", i.message))
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
        let key = format!("{}:artifact:0", req.job_id);
        self.post(
            req,
            &item,
            "artifact",
            &who.id,
            None,
            &text,
            json!({"room_plan": {
                "room": room_plan.room,
                "items": room_plan.items.len(),
                "cost_cents": room_plan.cost_cents,
                "parts": room_plan.parts,
                "repairs": round,
                "issues": lines(&room_plan.issues),
            }}),
            Some(&key),
        )
        .await?;
        self.report_job(
            req,
            Some(&who),
            ProgressState::Done,
            json!({"items": room_plan.items.len(), "repairs": round}),
        );
        let n = u8::try_from(room_plan.items.len().min(10)).unwrap_or(10);
        Ok(vec![
            Outcome::InteriorPlan {
                job_id: req.job_id,
                items: sim_items,
            },
            Outcome::JobCompleted {
                job_id: req.job_id,
                digest: Digest {
                    ok: true,
                    score: n,
                    words: 0,
                    qa_defects: u16::from(round),
                    artifact_sha: Some(sha),
                },
            },
        ])
    }

    /// The `Construct` job: the sim places the plan's items itself, one by
    /// one; the job reports the build in the item's thread.
    pub(crate) async fn construct(&self, req: &JobRequest) -> Result<Vec<Outcome>> {
        let item = self.work_item(req)?.to_string();
        let who = req.staff.first().cloned();
        self.report_job(req, who.as_ref(), ProgressState::Started, json!({}));
        let plan = self
            .load_artifact(req, &item)
            .await?
            .and_then(|a| a.room_plan)
            .ok_or_else(|| invalid(format!("{item} has no room plan to build")))?;
        self.system_post(
            req,
            &item,
            "status",
            0,
            &format!(
                "Construction of {} started: {} items go up one by one, in the plan's order.",
                plan.room,
                plan.items.len()
            ),
            json!({"room_plan": "construction", "room": plan.room, "items": plan.items.len(), "cost_cents": plan.cost_cents}),
        )
        .await?;
        self.report_job(
            req,
            who.as_ref(),
            ProgressState::Done,
            json!({"items": plan.items.len()}),
        );
        let sha = stage_hash(&[&serde_json::to_string(&plan).map_err(corrupt)?]);
        Ok(vec![Outcome::JobCompleted {
            job_id: req.job_id,
            digest: Digest {
                ok: true,
                score: 0,
                words: u32::try_from(plan.items.len()).unwrap_or(u32::MAX),
                qa_defects: 0,
                artifact_sha: Some(sha),
            },
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variant_names() {
        assert_eq!(variant_name("desk"), "Desk");
        assert_eq!(variant_name("desk-lamp"), "DeskLamp");
        assert_eq!(variant_name("mood-board-wall"), "MoodBoardWall");
    }

    #[test]
    fn on_desk_serializes_as_the_contract_says() {
        let i = RoomPlanItem {
            design: "monitor".into(),
            x_mm: 0,
            z_mm: 0,
            rot: 0,
            on_desk: Some(OnDesk::Planned(0)),
        };
        assert_eq!(
            serde_json::to_value(&i).unwrap(),
            json!({"design":"monitor","x_mm":0,"z_mm":0,"rot":0,"on_desk":{"planned":0}})
        );
        let e = OnDesk::Existing("equip-3".into());
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            json!({"existing":"equip-3"})
        );
        let f = RoomPlanItem { on_desk: None, ..i };
        assert_eq!(serde_json::to_value(&f).unwrap()["on_desk"], Value::Null);
    }
}
