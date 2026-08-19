package com.scholiast.android.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/** CRUD for [SyncMetaEntity]. */
@Dao
interface SyncMetaDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(meta: SyncMetaEntity)

    @Query("SELECT * FROM sync_meta WHERE `key` = :key")
    suspend fun get(key: String): SyncMetaEntity?

    @Query("SELECT * FROM sync_meta")
    suspend fun getAll(): List<SyncMetaEntity>

    @Query("DELETE FROM sync_meta WHERE `key` = :key")
    suspend fun delete(key: String)

    @Query("DELETE FROM sync_meta")
    suspend fun deleteAll()
}