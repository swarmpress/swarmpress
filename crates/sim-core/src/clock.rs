//! In-game time: step counter → day and minute of day, day phases and the
//! daylight window. All integer math.

use serde::{Deserialize, Serialize};

/// Simulation steps per real second. One step = 100 ms.
pub const STEPS_PER_SECOND: u64 = 10;

/// Minutes in an in-game day.
pub const MINUTES_PER_DAY: u64 = 24 * 60;

/// Minute of day from hours and minutes.
pub const fn hm(h: u16, m: u16) -> u16 {
    h * 60 + m
}

/// Sunlight is strong enough to light a windowed room.
pub const DAYLIGHT_START: u16 = hm(7, 30);
/// Sunlight is too weak after this; windowed rooms need lights again.
pub const DAYLIGHT_END: u16 = hm(16, 30);
/// Arrival phase start (end of night).
pub const ARRIVAL_START: u16 = hm(6, 0);
/// Morning standup in the meeting room.
pub const STANDUP_START: u16 = hm(9, 0);
/// End of the standup.
pub const STANDUP_END: u16 = hm(9, 20);
/// Staff who arrive later than this skip the standup.
pub const STANDUP_LATEST_ARRIVAL: u16 = hm(9, 5);
/// Lunch phase (individual lunch breaks are jittered around it).
pub const LUNCH_START: u16 = hm(12, 30);
/// End of the lunch phase.
pub const LUNCH_END: u16 = hm(13, 30);
/// Individual lunch break length in minutes.
pub const LUNCH_MINUTES: u16 = 40;
/// Evening / overtime starts; fatigue doubles and overtime pay accrues.
pub const EVENING_START: u16 = hm(18, 0);
/// Desk lamps switch on for seated staff from this minute.
pub const DESK_LAMP_ON: u16 = hm(17, 0);
/// Night starts.
pub const NIGHT_START: u16 = hm(22, 0);
/// The Secretary prepares the CEO briefing.
pub const BRIEFING_TIME: u16 = hm(8, 30);
/// Monday KPI review (data scientist → CEO office).
pub const KPI_REVIEW_START: u16 = hm(9, 30);
pub const KPI_REVIEW_END: u16 = hm(10, 0);
/// Monday's editorial board (ADR-0069): it opens in this window and runs
/// until its outcome arrives, at most `plan::BOARD_TIMEOUT_MINUTES`.
pub const BOARD_START: u16 = hm(10, 0);
pub const BOARD_END: u16 = hm(10, 20);
/// Friday finance review (CFO → CEO office).
pub const FINANCE_REVIEW_START: u16 = hm(16, 0);
pub const FINANCE_REVIEW_END: u16 = hm(16, 30);

/// Day of the week, Monday first. Day 0 is a Monday.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Weekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl Weekday {
    pub const fn of_day(day: u32) -> Weekday {
        match day % 7 {
            0 => Weekday::Monday,
            1 => Weekday::Tuesday,
            2 => Weekday::Wednesday,
            3 => Weekday::Thursday,
            4 => Weekday::Friday,
            5 => Weekday::Saturday,
            _ => Weekday::Sunday,
        }
    }
}

/// Tunables that are fixed for the lifetime of a world.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimConfig {
    /// Real minutes per in-game day (live servers use 60).
    pub day_real_minutes: u64,
    /// In-game minute-of-day at step 0 (default 07:00, before the office opens).
    pub start_minute: u64,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            day_real_minutes: 20,
            start_minute: 7 * 60,
        }
    }
}

impl SimConfig {
    /// Steps in one in-game day. Never 0 (a zero-length day is clamped to 1 real minute).
    pub fn steps_per_day(&self) -> u64 {
        self.day_real_minutes.max(1) * 60 * STEPS_PER_SECOND
    }

    /// Clock at an absolute step.
    pub fn clock_at(&self, step: u64) -> Clock {
        let elapsed =
            u128::from(step) * u128::from(MINUTES_PER_DAY) / u128::from(self.steps_per_day());
        let total = u128::from(self.start_minute % MINUTES_PER_DAY) + elapsed;
        let per_day = u128::from(MINUTES_PER_DAY);
        Clock {
            day: (total / per_day) as u32,
            minute: (total % per_day) as u16,
        }
    }
}

/// In-game time derived from the step counter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Clock {
    pub day: u32,
    /// Minute of day, 0..1440.
    pub minute: u16,
}

impl Clock {
    /// Minutes since day 0, 00:00.
    pub fn total_minutes(&self) -> u64 {
        u64::from(self.day) * MINUTES_PER_DAY + u64::from(self.minute)
    }

    pub fn weekday(&self) -> Weekday {
        Weekday::of_day(self.day)
    }

    pub fn phase(&self) -> DayPhase {
        DayPhase::at(self.minute)
    }

    /// Outside light is strong enough for windowed rooms (07:30–16:30).
    pub fn is_daylight(&self) -> bool {
        (DAYLIGHT_START..DAYLIGHT_END).contains(&self.minute)
    }
}

/// Coarse phase of the working day.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DayPhase {
    /// 22:00–06:00
    Night,
    /// 06:00–09:00
    Arrival,
    /// 09:00–09:20
    Standup,
    /// 09:20–12:30 and 13:30–18:00
    Work,
    /// 12:30–13:30
    Lunch,
    /// 18:00–22:00 (overtime)
    Evening,
}

impl DayPhase {
    pub fn at(minute: u16) -> DayPhase {
        match minute {
            m if !(ARRIVAL_START..NIGHT_START).contains(&m) => DayPhase::Night,
            m if m < STANDUP_START => DayPhase::Arrival,
            m if m < STANDUP_END => DayPhase::Standup,
            m if m < LUNCH_START => DayPhase::Work,
            m if m < LUNCH_END => DayPhase::Lunch,
            m if m < EVENING_START => DayPhase::Work,
            _ => DayPhase::Evening,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phases_cover_the_day() {
        assert_eq!(DayPhase::at(0), DayPhase::Night);
        assert_eq!(DayPhase::at(hm(5, 59)), DayPhase::Night);
        assert_eq!(DayPhase::at(hm(6, 0)), DayPhase::Arrival);
        assert_eq!(DayPhase::at(hm(9, 0)), DayPhase::Standup);
        assert_eq!(DayPhase::at(hm(9, 20)), DayPhase::Work);
        assert_eq!(DayPhase::at(hm(12, 45)), DayPhase::Lunch);
        assert_eq!(DayPhase::at(hm(15, 0)), DayPhase::Work);
        assert_eq!(DayPhase::at(hm(19, 0)), DayPhase::Evening);
        assert_eq!(DayPhase::at(hm(22, 0)), DayPhase::Night);
        assert_eq!(DayPhase::at(hm(23, 59)), DayPhase::Night);
    }

    #[test]
    fn daylight_window() {
        let c = |minute| Clock { day: 0, minute };
        assert!(!c(hm(7, 29)).is_daylight());
        assert!(c(hm(7, 30)).is_daylight());
        assert!(c(hm(16, 29)).is_daylight());
        assert!(!c(hm(16, 30)).is_daylight());
    }

    #[test]
    fn clock_at_is_integer_and_monotonic() {
        let cfg = SimConfig::default();
        assert_eq!(cfg.steps_per_day(), 12_000);
        let mut prev = cfg.clock_at(0);
        assert_eq!(
            prev,
            Clock {
                day: 0,
                minute: 420
            }
        );
        for step in 1..30_000 {
            let c = cfg.clock_at(step);
            assert!(c.total_minutes() >= prev.total_minutes());
            assert!(c.total_minutes() - prev.total_minutes() <= 1);
            prev = c;
        }
    }

    #[test]
    fn zero_length_day_is_clamped() {
        let cfg = SimConfig {
            day_real_minutes: 0,
            start_minute: 0,
        };
        assert_eq!(cfg.steps_per_day(), 600);
        assert_eq!(cfg.clock_at(600), Clock { day: 1, minute: 0 });
    }
}
