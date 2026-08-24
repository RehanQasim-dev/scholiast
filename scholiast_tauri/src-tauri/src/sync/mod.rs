//! Per-page Google Drive sync (task-17): 3-way reconcile engine over
//! [`crate::drive::rest::DriveRest`] using the shared merge rules in
//! `scholiast_core::merge`.

pub mod commands;
pub mod engine;
pub mod reader_apply;
pub mod scheduler;
