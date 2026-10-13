//! The fake web designer (`?llm=fake`, tests): it reads the task and the presets from the
//! prompt (the JSON blocks after [`TASK_MARK`] and [`PRESETS_MARK`]) and answers the
//! reference markup ([`crate::sketch`]). Like a careful junior, its first answer for the
//! front page sets one raw colour, which the checks catch and its `fix` answer removes:
//! every run of the job with the fake goes through one repair round.

use serde_json::{json, Value};

use crate::model::{Presets, TemplateTask};
use crate::sketch;

/// What precedes the task's JSON in a web designer prompt.
pub const TASK_MARK: &str = "The task (JSON):";
/// What precedes the presets' JSON.
pub const PRESETS_MARK: &str = "The presets (JSON):";
/// The template whose first answer carries the slip.
pub const SLIP_TEMPLATE: &str = "front-page";

/// The JSON object after `mark` (in a ```json fence or not).
pub fn json_after(prompt: &str, mark: &str) -> Option<Value> {
    let at = prompt.find(mark)? + mark.len();
    let rest = &prompt[at..];
    let start = rest.find('{')?;
    let mut it = serde_json::Deserializer::from_str(&rest[start..]).into_iter::<Value>();
    it.next()?.ok()
}

/// The task and presets a prompt carries.
pub fn read(prompt: &str) -> Option<(TemplateTask, Presets)> {
    let task = serde_json::from_value(json_after(prompt, TASK_MARK)?).ok()?;
    let presets = serde_json::from_value(json_after(prompt, PRESETS_MARK)?).ok()?;
    Some((task, presets))
}

/// The answer to a `web design template` call (`fix: false`) or its repair (`fix: true`):
/// `{"content": "<markup>"}`. A prompt without a task gets an empty answer, which the
/// checks refuse.
pub fn answer(prompt: &str, fix: bool) -> Value {
    let Some((task, presets)) = read(prompt) else {
        return json!({"content": ""});
    };
    let mut markup = sketch::template(&task, &presets);
    if !fix && task.slug == SLIP_TEMPLATE {
        if let Some(text) = presets.role("text").and_then(|t| presets.colors.get(t)) {
            markup = markup.replacen(
                "\"className\":\"sp-",
                &format!("\"style\":{{\"color\":{{\"text\":\"{text}\"}}}},\"className\":\"sp-"),
                1,
            );
        }
    }
    json!({"content": markup})
}
