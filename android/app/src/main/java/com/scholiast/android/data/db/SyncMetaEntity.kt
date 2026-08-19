package com.scholiast.android.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Generic key-value sync bookkeeping, mirroring the desktop's storage.local
 * keys: `tag_index` (JSON string array of tags, no `#` prefix, sorted), plus
 * anything the sync worker (Task 18) and settings (Task 19) need — last-synced
 * timestamps, sync status, pending URLs, etc. `value` is a JSON string; the
 * consumer owns its shape.
 */
@Entity(tableName = "sync_meta")
data class SyncMetaEntity(
    @PrimaryKey val key: String,
    val value: String,
    val updatedAt: Long,
)