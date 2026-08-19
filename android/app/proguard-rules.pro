# Keep kotlinx.serialization rules; concrete rules land with their features (Task 02+).
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.scholiast.android.** {
    *** Companion;
}
-keepclasseswithmembers class com.scholiast.android.** {
    kotlinx.serialization.KSerializer serializer(...);
}