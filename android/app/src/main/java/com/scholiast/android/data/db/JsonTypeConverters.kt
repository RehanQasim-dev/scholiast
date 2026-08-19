package com.scholiast.android.data.db

import androidx.room.TypeConverter
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoPage

/**
 * Converts the JSON-column types. Registered on [AppDatabase]; applied to entity
 * columns and — more usefully — to query result types, so the DAO can return
 * parsed DTOs straight from raw TEXT columns (see [VideoPageDao.loadPage]).
 */
class JsonTypeConverters {

    @TypeConverter
    fun itemsFromJson(json: String): List<VideoItem> = ScholiastJson.decode(json)

    @TypeConverter
    fun itemsToJson(items: List<VideoItem>): String = ScholiastJson.encode(items)

    @TypeConverter
    fun pageFromJson(json: String?): VideoPage? = json?.let { ScholiastJson.decode(it) }

    @TypeConverter
    fun pageToJson(page: VideoPage?): String? = page?.let { ScholiastJson.encode(it) }
}