package com.honeyappa.caronwatch

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import kotlinx.coroutines.delay

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
    MaterialTheme {
        var screen by remember { mutableStateOf("main") }
        Scaffold(
            timeText = { TimeText() },
            vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) }
        ) {
            when (screen) {
                "setup" -> SetupScreen(link, onPwd = { screen = "pwd" }, onDone = { screen = "main" })
                "pwd" -> PwdScreen(link, onDone = { screen = "main" })
                else -> MainScreen(link, onSetup = { screen = "setup" })
            }
            if (link.message.isNotEmpty()) {
                LaunchedEffect(link.message) { delay(2200); link.message = "" }
                Row(
                    modifier = Modifier.fillMaxSize().padding(bottom = 10.dp),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.Center
                ) { Text(link.message, fontSize = 12.sp, textAlign = TextAlign.Center) }
            }
        }
    }
}

@Composable
private fun MainScreen(link: CarLink, onSetup: () -> Unit) {
    val listState = rememberScalingLazyListState()
    var armStart by remember { mutableStateOf(false) }
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            val state = when {
                !link.online && link.scanning -> "검색 중…"
                !link.online -> "연결 안 됨"
                link.locked -> "잠김"
                else -> "열림"
            }
            val color = when {
                !link.online -> MaterialTheme.colors.onSurfaceVariant
                link.locked -> MaterialTheme.colors.primary
                else -> MaterialTheme.colors.secondary
            }
            Text(
                state, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = color,
                textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 2.dp)
            )
        }
        item {
            Text(
                link.name + if (link.mode == "mp686") " · 크라운" else if (link.mode == "demo") " · 데모" else "",
                fontSize = 12.sp, color = MaterialTheme.colors.onSurfaceVariant,
                textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 4.dp)
            )
        }
        if (!link.online) {
            item {
                PrimaryChip(if (link.scanning) "검색 중…" else "연결", enabled = !link.scanning && !link.busy) { link.connectSaved() }
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
                SecondaryChip(label, enabled = !link.busy) {
                    when {
                        running -> { link.send(CarLink.STOP); armStart = false }
                        armStart -> { link.send(CarLink.START); armStart = false }
                        else -> armStart = true
                    }
                }
            }
            item { SecondaryChip("찾기", enabled = !link.busy) { link.send(CarLink.FIND) } }
        }
        item { SecondaryChip("기기 설정", enabled = !link.scanning) { onSetup() } }
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
        item { SecondaryChip("데모") { link.setDemo(); onDone() } }
        item { SecondaryChip("닫기") { onDone() } }
    }
}

@Composable
private fun PwdScreen(link: CarLink, onDone: () -> Unit) {
    var digits by remember { mutableStateOf(intArrayOf(0, 0, 0, 0, 0, 0)) }
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item { Text("크라운 비밀번호", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (i in 0 until 6) {
                    CompactChip(
                        onClick = { digits = digits.copyOf().also { it[i] = (it[i] + 1) % 10 } },
                        label = { Text("${digits[i]}", fontSize = 16.sp) }
                    )
                }
            }
        }
        item { Text("숫자를 눌러 올리기 · 기본 000000", fontSize = 11.sp, color = MaterialTheme.colors.onSurfaceVariant, textAlign = TextAlign.Center) }
        item { PrimaryChip("연결") { link.registerMp(digits.joinToString("")); onDone() } }
        item { SecondaryChip("취소") { onDone() } }
    }
}

@Composable
private fun PrimaryChip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Chip(
        onClick = onClick, enabled = enabled,
        label = { Text(label, fontSize = 17.sp) },
        colors = ChipDefaults.primaryChipColors(),
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun SecondaryChip(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Chip(
        onClick = onClick, enabled = enabled,
        label = { Text(label, fontSize = 16.sp) },
        colors = ChipDefaults.secondaryChipColors(),
        modifier = Modifier.fillMaxWidth()
    )
}
