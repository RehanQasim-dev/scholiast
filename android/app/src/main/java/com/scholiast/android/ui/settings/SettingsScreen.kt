package com.scholiast.android.ui.settings

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.domain.sync.SyncState
import com.scholiast.android.domain.transcribe.TranscriberSource

/** The Settings window. Sections: speech, local STT, Drive, data. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    viewModel: SettingsViewModel = viewModel(
        factory = SettingsViewModel.factory(LocalContext.current.applicationContext),
    ),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentAlignment = Alignment.TopCenter,
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxHeight()
                    .widthIn(max = 600.dp)
                    .fillMaxWidth()
                    .wrapContentWidth(Alignment.CenterHorizontally),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item { SettingsSectionTitle("Speech API Keys") }
                item {
                    KeyField(
                        label = "Groq API key (Cloud Whisper)",
                        hasKey = state.groqKeySet,
                        onSave = viewModel::setGroqKey,
                    )
                }
                item {
                    KeyField(
                        label = "Google AI key (Gemini speech + Gemma OCR)",
                        hasKey = state.geminiKeySet || state.gemmaKeySet,
                        onSave = viewModel::setGeminiKey,
                    )
                }
                item { SettingsSectionTitle("Transcription Engine") }
                item {
                    Text("Preferred Transcriber", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(6.dp))
                    TranscriberPicker(
                        selected = state.preferredTranscriber,
                        groqKeySet = state.groqKeySet,
                        geminiKeySet = state.geminiKeySet || state.gemmaKeySet,
                        onChange = viewModel::setPreferredTranscriber,
                    )
                }
                item {
                    Text("Speech Language", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(6.dp))
                    SpeechLanguagePicker(
                        selectedCode = state.speechLanguage,
                        onChange = { viewModel.setSpeechLanguage(it) },
                    )
                }
                item {
                    ModelSection(
                        title = "Local Whisper Model (Offline GGML)",
                        installed = remember(state.message, state.activeSttModel) { viewModel.installedModels() },
                        activeModel = state.activeSttModel,
                        onOpenModelsPage = viewModel::openModelsPage,
                        onImportAny = viewModel::importAnyModel,
                        onActivate = viewModel::setActiveSttModel,
                        deleteModel = viewModel::deleteModel,
                    )
                }
                item { SettingsSectionTitle("Cloud Sync") }
                item {
                    DriveSection(
                        connected = state.driveConnected,
                        configured = state.driveConfigured,
                        syncing = state.syncing,
                        syncState = state.syncState,
                        syncDetail = state.syncDetail,
                        lastError = state.lastSyncError,
                        onConnect = viewModel::connectDrive,
                        onDisconnect = viewModel::disconnectDrive,
                        onSyncNow = viewModel::syncNow,
                    )
                }
                item { SettingsSectionTitle("Data Management") }
                item {
                    DataSection(
                        busy = state.busy,
                        onWipeLocal = viewModel::wipeLocalData,
                        onWipeDrive = viewModel::wipeDriveData,
                    )
                }
                item { Spacer(Modifier.height(12.dp)) }
                item {
                    Text(
                        "Scholiast v${viewModel.versionName()}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsSectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.padding(top = 12.dp),
    )
}

@Composable
private fun KeyField(
    label: String,
    hasKey: Boolean,
    onSave: (String?) -> Unit,
) {
    var value by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf(!hasKey) }
    var visible by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth().widthIn(max = 600.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                if (hasKey && !editing) {
                    Icon(Icons.Default.Check, contentDescription = "Key saved", tint = MaterialTheme.colorScheme.primary)
                }
            }
            if (editing) {
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    singleLine = true,
                    label = { Text("Paste key") },
                    visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { visible = !visible }) {
                            Icon(
                                imageVector = if (visible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                                contentDescription = if (visible) "Hide" else "Show",
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { onSave(value.ifBlank { null }); editing = false; value = "" },
                        enabled = value.isNotBlank(),
                    ) {
                        Text("Save key")
                    }
                    if (hasKey) {
                        TextButton(onClick = { onSave(null); editing = false }) { Text("Remove") }
                        TextButton(onClick = { editing = false }) { Text("Cancel") }
                    }
                }
            } else {
                TextButton(onClick = { editing = true }) { Text("Replace key") }
            }
        }
    }
}

/** Friendly display name for a backend; the raw enum names never reach the UI. */
private fun transcriberLabel(source: TranscriberSource): String = when (source) {
    TranscriberSource.LOCAL -> "Local (on-device)"
    TranscriberSource.GROQ -> "Groq Whisper (cloud)"
    TranscriberSource.GEMINI -> "Gemini (cloud)"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TranscriberPicker(
    selected: TranscriberSource,
    groqKeySet: Boolean,
    geminiKeySet: Boolean,
    onChange: (TranscriberSource) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.fillMaxWidth().widthIn(max = 600.dp),
    ) {
        OutlinedTextField(
            value = transcriberLabel(selected),
            onValueChange = {},
            readOnly = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            TranscriberSource.entries.forEach { source ->
                DropdownMenuItem(
                    text = { Text(transcriberLabel(source)) },
                    onClick = { onChange(source); expanded = false },
                )
            }
        }
    }
    // Cloud backends stay selectable without a key, but say so.
    val keyMissing = when (selected) {
        TranscriberSource.GROQ -> !groqKeySet
        TranscriberSource.GEMINI -> !geminiKeySet
        TranscriberSource.LOCAL -> false
    }
    if (keyMissing) {
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Filled.Warning,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                if (selected == TranscriberSource.GROQ) "Requires the Groq API key above."
                else "Requires the Google AI key above.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private data class LanguageOption(val code: String?, val label: String)

private val SPEECH_LANGUAGES = listOf(
    LanguageOption(null, "English"),
    LanguageOption("es", "Spanish (Español)"),
    LanguageOption("fr", "French (Français)"),
    LanguageOption("de", "German (Deutsch)"),
    LanguageOption("it", "Italian (Italiano)"),
    LanguageOption("pt", "Portuguese (Português)"),
    LanguageOption("zh", "Chinese (中文)"),
    LanguageOption("ja", "Japanese (日本語)"),
    LanguageOption("ko", "Korean (한국어)"),
    LanguageOption("ru", "Russian (Русский)"),
    LanguageOption("ar", "Arabic (العربية)"),
    LanguageOption("hi", "Hindi (हिन्दी)"),
    LanguageOption("auto", "Auto-detect"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SpeechLanguagePicker(
    selectedCode: String?,
    onChange: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val currentLabel = SPEECH_LANGUAGES.firstOrNull { it.code == selectedCode }?.label
        ?: if (selectedCode.isNullOrBlank()) "English" else selectedCode

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = it },
        modifier = Modifier.fillMaxWidth().widthIn(max = 600.dp),
    ) {
        OutlinedTextField(
            value = currentLabel,
            onValueChange = {},
            readOnly = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            SPEECH_LANGUAGES.forEach { opt ->
                DropdownMenuItem(
                    text = { Text(opt.label) },
                    onClick = {
                        onChange(opt.code)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun ModelSection(
    title: String,
    installed: List<String>,
    activeModel: String?,
    onOpenModelsPage: () -> Unit,
    onImportAny: (Uri) -> Unit,
    onActivate: (String) -> Unit,
    deleteModel: (String) -> Unit,
) {
    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) onImportAny(uri)
    }

    Card(modifier = Modifier.fillMaxWidth().widthIn(max = 600.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(
                "Fast local Whisper engine running fully on-device. Download official GGML .bin models from FUTO and load them into Scholiast.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // Current Model Status Banner
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHighest,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f, fill = false)) {
                        Text(
                            text = "Active Engine Model",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = activeModel ?: "Default Tiny English (built-in)",
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = if (activeModel != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    if (activeModel != null) {
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                        ) {
                            Text(
                                text = "ACTIVE",
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            // Standard paired action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(
                    onClick = onOpenModelsPage,
                    modifier = Modifier.height(44.dp),
                ) {
                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Explore Models")
                }
                OutlinedButton(
                    onClick = { importLauncher.launch(arrayOf("application/octet-stream", "*/*")) },
                    modifier = Modifier.height(44.dp),
                ) {
                    Icon(Icons.Default.UploadFile, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Load .bin File")
                }
            }

            if (installed.isNotEmpty()) {
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
                Text("Installed Models", style = MaterialTheme.typography.labelMedium)
                installed.forEach { fileName ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            fileName,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.weight(1f),
                        )
                        if (fileName == activeModel) {
                            Text(
                                "Active",
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(end = 8.dp),
                            )
                        } else {
                            TextButton(onClick = { onActivate(fileName) }) { Text("Use") }
                        }
                        IconButton(onClick = { deleteModel(fileName) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DriveSection(
    connected: Boolean,
    configured: Boolean,
    syncing: Boolean,
    syncState: SyncState,
    syncDetail: String,
    lastError: String?,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onSyncNow: () -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth().widthIn(max = 600.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (connected) "Connected to Google Drive (appdata)" else "Not connected",
                style = MaterialTheme.typography.bodyLarge,
            )
            if (!configured) {
                Text(
                    "This build has no OAuth client values (oauth.local.json was empty at build time). Connect is unavailable.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            when (syncState) {
                SyncState.IDLE -> {}
                SyncState.CONNECTING -> Text("Connecting…", style = MaterialTheme.typography.bodySmall)
                SyncState.DISCOVERING -> Text("Discovering remote pages…", style = MaterialTheme.typography.bodySmall)
                SyncState.SYNCING -> Text("Syncing… $syncDetail", style = MaterialTheme.typography.bodySmall)
                SyncState.ERROR -> Text("Last sync failed: $lastError", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                SyncState.OFFLINE -> Text("Offline — will retry", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            if (syncing) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Sync in progress", style = MaterialTheme.typography.bodySmall)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (connected) {
                    OutlinedButton(onClick = onDisconnect) { Text("Disconnect") }
                    Button(onClick = onSyncNow) { Text("Sync now") }
                } else if (configured) {
                    Button(onClick = onConnect) { Text("Connect Google Drive") }
                }
            }
        }
    }
}

@Composable
private fun DataSection(
    busy: Boolean,
    onWipeLocal: () -> Unit,
    onWipeDrive: () -> Unit,
) {
    var showLocalDialog by remember { mutableStateOf(false) }
    var showDriveDialog by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth().widthIn(max = 600.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                "Data management actions are irreversible. Local wipes delete local notes/frames; Drive wipes delete remote sync records.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedButton(
                onClick = { showLocalDialog = true },
                enabled = !busy,
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error,
                ),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.7f)),
                modifier = Modifier.height(44.dp),
            ) {
                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Delete local data…")
            }

            OutlinedButton(
                onClick = { showDriveDialog = true },
                enabled = !busy,
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error,
                ),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.7f)),
                modifier = Modifier.height(44.dp),
            ) {
                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Delete Drive data…")
            }

            if (busy) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Working…", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    if (showLocalDialog) {
        AlertDialog(
            onDismissRequest = { showLocalDialog = false },
            title = { Text("Delete local data?") },
            text = {
                Text(
                    "This permanently deletes all notes, highlights, drawings, video items and frame " +
                        "images stored on this device. Your settings and the Drive connection are kept, " +
                        "and nothing is removed from Google Drive.",
                )
            },
            confirmButton = {
                TextButton(onClick = { showLocalDialog = false; onWipeLocal() }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLocalDialog = false }) { Text("Cancel") }
            },
        )
    }

    if (showDriveDialog) {
        var confirmText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showDriveDialog = false },
            title = { Text("Delete Drive data?") },
            text = {
                Column {
                    Text(
                        "This permanently deletes every synced page record, frame image and diagram " +
                            "blob from the app's Google Drive appdata folder. Annotations on this " +
                            "device are untouched.",
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = confirmText,
                        onValueChange = { confirmText = it },
                        singleLine = true,
                        label = { Text("Type DELETE to confirm") },
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { showDriveDialog = false; onWipeDrive() },
                    enabled = confirmText == "DELETE",
                ) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDriveDialog = false }) { Text("Cancel") }
            },
        )
    }
}