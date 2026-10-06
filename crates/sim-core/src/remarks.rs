//! Remarks: lines staff say outside meetings (ADR-0074, the story director).
//!
//! A `ServerCommand::Remark{speaker, listener, seq, chars}` puts a speech
//! bubble over a person on site who is not in a meeting, for as long as an
//! utterance of `chars` characters lasts ([`crate::world::utterance_steps`]).
//! The text never enters the sim (rule 2): the client fetches it by `seq`.
//! A remark changes nothing but the bubble and the pose: narrative has no
//! authority over production state.

use serde::{Deserialize, Serialize};

use crate::ids::StaffId;
use crate::world::{utterance_steps, World};
use crate::Reject;

/// The longest remark, characters.
pub const MAX_REMARK_CHARS: u32 = 600;

/// The latest remark of a person.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Remark {
    pub seq: u32,
    pub listener: Option<StaffId>,
    pub from_step: u64,
    pub until_step: u64,
    pub chars: u32,
}

impl World {
    /// Whether `s` is on site and not seated in a meeting in session.
    fn free_to_chat(&self, s: StaffId) -> bool {
        let now = self.clock();
        self.staff
            .get(&s)
            .is_some_and(|p| p.is_active() && p.is_on_site())
            && !self
                .meetings
                .values()
                .any(|m| m.is_active(now) && m.attendees.contains(&s))
    }

    /// Validates a remark (pure).
    pub(crate) fn check_remark(
        &self,
        speaker: StaffId,
        listener: Option<StaffId>,
        seq: u32,
        chars: u32,
    ) -> Result<(), Reject> {
        if seq != self.next_remark {
            return Err(Reject::OutOfOrder {
                expected: self.next_remark,
                got: seq,
            });
        }
        if chars == 0 || chars > MAX_REMARK_CHARS {
            return Err(Reject::Invalid("a remark is 1..=600 characters"));
        }
        if !self.free_to_chat(speaker) {
            return Err(Reject::Invalid(
                "the speaker is not on site or is in a meeting",
            ));
        }
        if let Some(l) = listener {
            if l == speaker || !self.free_to_chat(l) {
                return Err(Reject::Invalid(
                    "the listener is not on site or is in a meeting",
                ));
            }
        }
        Ok(())
    }

    /// Applies a remark (checked): the speaker's bubble from now.
    pub(crate) fn apply_remark(
        &mut self,
        speaker: StaffId,
        listener: Option<StaffId>,
        seq: u32,
        chars: u32,
    ) {
        let from = self.step;
        self.remarks.insert(
            speaker,
            Remark {
                seq,
                listener,
                from_step: from,
                until_step: from + utterance_steps(chars),
                chars,
            },
        );
        self.next_remark = seq + 1;
    }

    /// The remarks in progress at the current step, by speaker.
    pub fn remarks_now(&self) -> impl Iterator<Item = (StaffId, &Remark)> {
        let step = self.step;
        self.remarks
            .iter()
            .filter(move |(_, r)| step < r.until_step)
            .map(|(s, r)| (*s, r))
    }
}
