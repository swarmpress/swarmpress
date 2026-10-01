//! Wire protocol between the SimPress server and browser client.
//! Frames are postcard-encoded; bump [`PROTO_VERSION`] on any breaking change.

use serde::{Deserialize, Serialize};

pub const PROTO_VERSION: u16 = 1;

/// First frame the server sends after a client connects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    pub proto_version: u16,
    pub server_version: String,
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, postcard::Error> {
    postcard::to_allocvec(value)
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_round_trips() {
        let hello = Hello {
            proto_version: PROTO_VERSION,
            server_version: "0.2.0".into(),
        };
        let bytes = encode(&hello).unwrap();
        assert_eq!(decode::<Hello>(&bytes).unwrap(), hello);
    }
}
