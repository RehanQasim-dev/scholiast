package com.scholiast.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
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
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scholiast.android.domain.sync.SyncState
import com.scholiast.android.domain.transcribe.TranscriberSource
import com.scholiast.android.domain.voice.local.ENGLISH_MODELS
import com.scholiast.android.domain.voice.local.Models
import com.scholiast.android.domain.voice.local.ModelLoader

/** The Settings window (Task 19). Sections: speech, local STT, Drive, data. */
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
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { SettingsSectionTitle("Speech") }
            item {
                KeyField(
                    label = "Groq API key (cloud Whisper)",
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
            item { SettingsSectionTitle("Transcriber") }
            item {
                Text("Preferred transcriber", style = MaterialTheme.typography.bodyMedium)
                TranscriberPicker(
                    selected = state.preferredTranscriber,
                    onChange = viewModel::setPreferredTranscriber,
                )
            }
            item {
                Text("Speech language (blank = English)", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = state.speechLanguage ?: "",
                    onValueChange = { viewModel.setSpeechLanguage(it.ifBlank { null }) },
                    singleLine = true,
                    placeholder = { Text("en") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                ModelSection(
                    title = "Local STT model (offline; FUTO Whisper)",
                    models = ENGLISH_MODELS,
                    installed = remember(state.message) { viewModel.installedModels() },
                    downloadModel = viewModel::downloadModel,
                    deleteModel = viewModel::deleteModel,
                )
            }
            item { SettingsSectionTitle("Drive sync") }
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
            item { SettingsSectionTitle("Data") }
            item {
                DataSection(
                    busy = state.busy,
                    onWipeLocal = viewModel::wipeLocalData,
                    onWipeDrive = viewModel::wipeDriveData,
                )
            }
            item { Spacer(Modifier.height(8.dp)) }
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

@Composable
private fun SettingsSectionTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 8.dp),
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

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                if (hasKey && !editing) {
                    Icon(Icons.Default.Check, contentDescription = "Key saved", tint = MaterialTheme.colorScheme.primary)
                }
            }
            if (editing) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it },
                        singleLine = true,
                        label = { Text("Paste key") },
                        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = { visible = !visible }) {
                        Icon(Icons.Default.Edit, contentDescription = if (visible) "Hide" else "Show")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onSave(value.ifBlank { null }); editing = false; value = "" }) {
                        Text("Save")
                    }
                    if (hasKey) {
                        TextButton(onClick = { onSave(null); editing = false }) { Text("Remove") }
                    }
                }
            } else {
                TextButton(onClick = { editing = true }) { Text("Replace key") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TranscriberPicker(
    selected: TranscriberSource,
    onChange: (TranscriberSource) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = selected.name,
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
                    text = { Text(source.name) },
                    onClick = { onChange(source); expanded = false },
                )
            }
        }
    }
}

@Composable
private fun ModelSection(
    title: String,
    models: List<ModelLoader>,
    installed: List<String>,
    downloadModel: (ModelLoader) -> Unit,
    deleteModel: (String) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(
                "Models come from ${Models.MODELS_PAGE_URL}. If a file 404s, copy the .bin into the app's stt_models folder manually.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            models.forEach { model ->
                val fileName = model.fileName()
                val isInstalled = fileName in installed
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        model.name,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    if (isInstalled) {
                        Icon(Icons.Default.Check, contentDescription = "Installed", tint = MaterialTheme.colorScheme.primary)
                        TextButton(onClick = { deleteModel(fileName) }) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete")
                        }
                    } else {
                        Button(onClick = { downloadModel(model) }) {
                            Icon(Icons.Default.Download, contentDescription = null)
                            Spacer(Modifier.width(4.dp))
                            Text("Download")
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
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (connected) "Connected to Google Drive (appdata)" else "Not connected",
                style = MaterialTheme.typography.bodyLarge,
            )
            if (!configured) {
                Text(
                    "This build has no OAuth client values (oauth.local.json was empty at build time). Connect is unavailable.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
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
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Wipes are destructive. Local wipes keep settings and the Drive connection; Drive wipes keep local annotations.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            var confirmLocal by remember { mutableStateOf(false) }
            var confirmDrive by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (confirmLocal) {
                    Button(onClick = { onWipeLocal(); confirmLocal = false }, enabled = !busy) { Text("Delete ALL local data") }
                    TextButton(onClick = { confirmLocal = false }) { Text("Cancel") }
                } else {
                    OutlinedButton(onClick = { confirmLocal = true }) { Text("Delete local data…") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (confirmDrive) {
                    Button(onClick = { onWipeDrive(); confirmDrive = false }, enabled = !busy) { Text("Delete ALL Drive data") }
                    TextButton(onClick = { confirmDrive = false }) { Text("Cancel") }
                } else {
                    OutlinedButton(onClick = { confirmDrive = true }) { Text("Delete Drive data…") }
                }
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
}