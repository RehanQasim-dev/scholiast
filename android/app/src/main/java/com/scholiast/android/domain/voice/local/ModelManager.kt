package com.scholiast.android.domain.voice.local

import java.io.File

/**
 * Model cache, ported from the FUTO Keyboard's `whisper/ModelManager.kt`
 * (FUTO Source First License 1.1). One open [WhisperGGML] per model key; never on the
 * main thread.
 */
class ModelManager(private val modelsDir: File) {
    private val loadedModels: HashMap<Any, WhisperGGML> = hashMapOf()

    fun obtainModel(model: ModelLoader): WhisperGGML {
        val key = model.key(modelsDir)
        if (!loadedModels.containsKey(key)) {
            loadedModels[key] = model.loadGGML(modelsDir)
        }
        return loadedModels[key]!!
    }

    fun cancelAll() {
        loadedModels.forEach { it.value.cancel() }
    }

    suspend fun cleanUp() {
        for (model in loadedModels.entries) {
            model.value.cancel()
            model.value.close()
        }
        loadedModels.clear()
    }
}