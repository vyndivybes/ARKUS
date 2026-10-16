# ARKUS Android Companion — Health Connect preview

This is an **Android 14+ standalone activity reader**, not a remotely paired ARKUS desktop client and not a direct Garmin Connect login. It reads only approved Health Connect permissions: exercise sessions, steps and distance over the last 7 days. The user presses Connect to grant or revoke access in the Android system interface. No data is sent to ARKUS servers; Share is user-initiated and uses Android's chooser.

To include Garmin Connect data, enable **Garmin Connect → Health Connect** on Android 14+ and authorize sharing in Garmin, then grant ARKUS Companion read permissions. Garmin data flows one way into Health Connect; ARKUS makes no claim of direct Garmin cloud API connection. Other Health Connect producers may contribute aggregate totals and are never falsely attributed to Garmin. The app displays contributing source package names for exercise sessions.

GitHub Actions builds a debug APK on changes under android/. A debug APK is for evaluation only; no production signing, Google Play distribution, background service, live wearable connection, account pairing, desktop synchronization or identity verification is provided. For official direct cloud-to-cloud Garmin synchronization, separately apply for Garmin Connect Developer Program credentials.

Source: https://support.garmin.com/lv-LV/?faq=JToBEy0jfe6pIygark2Ui5
Android docs: https://developer.android.com/health-and-fitness/health-connect/get-started
