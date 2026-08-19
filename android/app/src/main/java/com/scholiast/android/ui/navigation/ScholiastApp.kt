package com.scholiast.android.ui.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.scholiast.android.ui.home.HomeScreen
import com.scholiast.android.ui.player.PlayerPanelPlaceholder
import com.scholiast.android.ui.player.PlayerScreen
import com.scholiast.android.ui.settings.SettingsScreen

@Composable
fun ScholiastApp() {
    val navController = rememberNavController()
    NavHost(
        navController = navController,
        startDestination = Routes.HOME,
    ) {
        composable(Routes.HOME) {
            HomeScreen(
                onOpenVideo = { videoId -> navController.navigate(Routes.player(videoId)) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.PLAYER) { backStackEntry ->
            val videoId = backStackEntry.arguments?.getString("videoId").orEmpty()
            PlayerScreen(
                videoId = videoId,
                onBack = { navController.popBackStack() },
                panelSlot = {
                    PlayerPanelPlaceholder(
                        onOpenVoiceEdit = { navController.navigate(Routes.VOICE_EDIT) },
                        onOpenFrame = { navController.navigate(Routes.FRAME) },
                    )
                },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.VOICE_EDIT) {
            PlaceholderScreen(
                title = "Edit by voice",
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.FRAME) {
            PlaceholderScreen(
                title = "Frame draw",
                onBack = { navController.popBackStack() },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PlaceholderScreen(title: String, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = MaterialTheme.typography.headlineMedium)
            Text(
                text = "Not implemented yet",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                onClick = onBack,
                modifier = Modifier.padding(top = 24.dp),
            ) {
                Text("Back")
            }
        }
    }
}