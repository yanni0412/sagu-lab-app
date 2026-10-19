package com.honeyappa.caronwatch

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import kotlinx.coroutines.delay

private val Amber = Color(0xFFF2A33A)
private val Green = Color(0xFF4FD18B)
private val Ink = Color(0xFFEEF1F4)
private val InkDim = Color(0xFF9AA3AF)
private val Dark = Color(0xFF1D1406)

private val CaronColors = Colors(
    primary = Amber,
    onPrimary = Dark,
    secondary = Color(0xFF30343A),
    onSecondary = Ink,
    background = Color.Black,
    onBackground = Ink,
    surface = Color(0xFF23262B),
    onSurface = Ink,
    onSurfaceVariant = InkDim,
    error = Color(0xFFFF6B5E),
    onError = Dark
)

class MainActivity : ComponentActivity() {
    private lateinit var link: CarLink

    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { link.connectSaved() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        link = CarLink(this)
        setContent { WearApp(link) }
        ensurePerms()
    }

    override fun onDestroy() {
        super.onDestroy()
        link.disconnect()
    }

    private fun ensurePerms() {
        val perms = if (Build.VERSION.SDK_INT >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        val missing = perms.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing) permLauncher.launch(perms) else link.connectSaved()
    }
}

@Composable
fun WearApp(link: CarLink) {
    MaterialTheme(colors = CaronColors) {
        var screen by remember { mutableStateOf("main") }
        val listState = rememberScalingLazyListState()
        Scaffold(
            timeText = { TimeText() },
            vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
            positionIndicator = { if (screen == "main") PositionIndicator(scalingLazyListState = listState) }
        ) {
            when (screen) {
                "setup" -> SetupScreen(link, onPwd = { screen = "pwd" }, onDone = { screen = "main" })
                "pwd" -> PwdScreen(link, onDone = { screen = "main" })
                else -> MainScreen(link, listState, onSetup = { screen = "setup" })
            }
            Toast(link)
        }
    }
}

@Composable
private fun MainScreen(link: CarLink, listState: ScalingLazyListState, onSetup: () -> Unit) {
    var armStart by remember { mutableStateOf(false) }
    LaunchedEffect(armStart) { if (armStart) { delay(3000); armStart = false } }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            val state = when {
                !link.online && (link.scanning || link.busy) -> "연결 중…"
                !link.online -> "연결 안 됨"
                link.locked -> "잠김"
                else -> "열림"
            }
            val color = when {
                !link.online -> InkDim
                link.locked -> Green
                else -> Amber
            }
            CenterColumn {
                Text(state, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = color, textAlign = TextAlign.Center)
                Text(
                    link.name + if (link.mode == "mp686") " · 크라운" else if (link.mode == "demo") " · 데모" else "",
                    fontSize = 12.sp, color = InkDim, textAlign = TextAlign.Center
                )
            }
        }
        if (!link.online) {
            item {
                if (link.scanning || link.busy) Spinner()
                else PrimaryChip("연결") { link.connectSaved() }
            }
        } else {
            item {
                PrimaryChip(if (link.locked) "열기" else "잠그기", enabled = !link.busy) {
                    link.send(if (link.locked) CarLink.UNLOCK else CarLink.LOCK)
                }
            }
            item { SecondaryChip("트렁크", enabled = !link.busy) { link.send(CarLink.TRUNK) } }
            item {
                val running = link.engine
                val label = if (running) "시동 끄기" else if (armStart) "다시 눌러 시동" else "시동"
                SecondaryChip(label, enabled = !link.busy, warn = armStart) {
                    when {
                        running -> { link.send(CarLink.STOP); armStart = false }
                        armStart -> { link.send(CarLink.START); armStart = false }
                        else -> armStart = true
                    }
                }
            }
            item { SecondaryChip("차량 찾기", enabled = !link.busy) { link.send(CarLink.FIND) } }
        }
        item { MiniChip("기기 설정", enabled = !link.scanning, onClick = onSetup) }
    }
}

@Composable
private fun SetupScreen(link: CarLink, onPwd: () -> Unit, onDone: () -> Unit) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item { Text("기기 설정", fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp)) }
        item { PrimaryChip("크라운 호환(MP686)") { onPwd() } }
        item { SecondaryChip("데모 모드") { link.setDemo(); onDone() } }
        item { MiniChip("닫기", onClick = onDone) }
    }
}

@Composable
private fun PwdScreen(link: CarLink, onDone: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    var digits by remember { mutableStateOf(intArrayOf(0, 0, 0, 0, 0, 0)) }
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item { Text("크라운 비밀번호", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                for (i in 0 until 6) {
                    CompactChip(
                        onClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            digits = digits.copyOf().also { it[i] = (it[i] + 1) % 10 }
                        },
                        label = { Text("${digits[i]}", fontSize = 18.sp, fontWeight = FontWeight.Bold) },
                        colors = ChipDefaults.secondaryChipColors()
                    )
                }
            }
        }
        item { Text("숫자를 눌러 올리기 · 기본 000000", fontSize = 11.sp, color = InkDim, textAlign = TextAlign.Center) }
        item { PrimaryChip("연결") { link.registerMp(digits.joinToString("")); onDone() } }
        item { MiniChip("취소", onClick = onDone) }
    }
}

/* ---- 공통 컴포넌트 ---- */
@Composable
private fun CenterColumn(content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(bottom = 6.dp)
    ) { content() }
}

@Composable
private fun Spinner() {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(modifier = Modifier.size(32.dp), strokeWidth = 3.dp)
    }
}

@Composable
private fun PrimaryChip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    Chip(
        onClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onClick() },
        enabled = enabled,
        label = { Text(label, fontSize = 18.sp, fontWeight = FontWeight.Bold) },
        colors = ChipDefaults.primaryChipColors(),
        modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp)
    )
}

@Composable
private fun SecondaryChip(label: String, enabled: Boolean = true, warn: Boolean = false, onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    Chip(
        onClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onClick() },
        enabled = enabled,
        label = { Text(label, fontSize = 16.sp, color = if (warn) Amber else Ink) },
        colors = ChipDefaults.secondaryChipColors(),
        modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp)
    )
}

@Composable
private fun MiniChip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    androidx.wear.compose.material.CompactChip(
        onClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); onClick() },
        enabled = enabled,
        label = { Text(label, fontSize = 13.sp, color = InkDim) },
        colors = ChipDefaults.secondaryChipColors()
    )
}

@Composable
private fun Toast(link: CarLink) {
    if (link.message.isEmpty()) return
    LaunchedEffect(link.message) { delay(2200); link.message = "" }
    Box(Modifier.fillMaxSize().padding(bottom = 14.dp), contentAlignment = Alignment.BottomCenter) {
        Box(
            Modifier
                .background(Color(0xF0F1F3F5), RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 7.dp)
        ) { Text(link.message, fontSize = 12.sp, color = Color(0xFF111418), textAlign = TextAlign.Center) }
    }
}
