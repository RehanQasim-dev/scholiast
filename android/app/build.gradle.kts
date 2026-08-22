import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// Task 16 hand-off: Drive OAuth client values are injected at build time from the
// gitignored ../oauth.local.json (or GOOGLE_OAUTH_* env vars), never committed.
// Missing file → placeholder values → OAuthConfig.isConfigured=false → the app
// works unconfigured and Settings' connect explains why.
val oauthLocalFile = rootProject.file("../oauth.local.json")
val oauthJson = if (oauthLocalFile.exists()) {
    groovy.json.JsonSlurper().parse(oauthLocalFile) as Map<String, Any>
} else emptyMap()
val oauthClientId: String = (oauthJson["nativeClientId"] as? String)
    ?: System.getenv("GOOGLE_OAUTH_NATIVE_CLIENT_ID").orEmpty()
val oauthClientSecret: String = (oauthJson["nativeClientSecret"] as? String)
    ?: System.getenv("GOOGLE_OAUTH_NATIVE_CLIENT_SECRET").orEmpty()

val buildTimestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))

android {
    namespace = "com.scholiast.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.scholiast.android"
        minSdk = 30
        targetSdk = 35
        versionCode = 2
        versionName = "0.1.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Task 16 hand-off: real client values when oauth.local.json exists (or
        // GOOGLE_OAUTH_* env vars); empty otherwise → OAuthConfig.isConfigured=false.
        buildConfigField("String", "OAUTH_CLIENT_ID", "\"$oauthClientId\"")
        buildConfigField("String", "OAUTH_CLIENT_SECRET", "\"$oauthClientSecret\"")
        buildConfigField("String", "BUILD_TIME", "\"$buildTimestamp\"")

        // Task 11: local STT (whisper.cpp). arm64-v8a for devices, x86_64 for the emulator.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    // Task 11: vendored whisper.cpp/GGML engine (see src/main/cpp/CMakeLists.txt).
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    // AGP's default NDK so it auto-downloads on machines without one installed.
    ndkVersion = "27.0.12077973"

    flavorDimensions += "environment"
    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
        }
        create("prod") {
            dimension = "environment"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.okhttp)
    implementation(libs.readability4j)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.coil.compose)
    // Coil 3 has NO network fetcher by default — without this every remote
    // AsyncImage (article images, favicons) fails silently → blank space.
    implementation(libs.coil.network.okhttp)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    // Task 23: migration unit test runs on Robolectric (real Room over a v1 db).
    testImplementation(libs.robolectric)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}