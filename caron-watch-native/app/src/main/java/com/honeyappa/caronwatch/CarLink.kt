package com.honeyappa.caronwatch

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.ArrayDeque
import java.util.UUID

/** 카온 워치 BLE 엔진 — 데모 + MP686(크라운 호환). 폰 앱과 같은 프로토콜. */
@SuppressLint("MissingPermission")
class CarLink(private val ctx: Context) {

    companion object {
        val MP_SVC: UUID = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb")
        val MP_CMD: UUID = UUID.fromString("0000ffe4-0000-1000-8000-00805f9b34fb")
        val MP_EVT: UUID = UUID.fromString("0000ffe9-0000-1000-8000-00805f9b34fb")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val LOCK = 0xC1; const val UNLOCK = 0xC2; const val TRUNK = 0xC3
        const val FIND = 0xC4; const val START = 0xC5; const val STOP = 0xC6
        private val WARN = mapOf(0xE1 to "문 열림", 0xE2 to "트렁크 열림", 0xE3 to "충격 감지", 0xE4 to "시동 경보")
    }

    // ---- Compose 상태 ----
    var mode by mutableStateOf("demo")   // "demo" | "mp686"
    var name by mutableStateOf("내 차")
    var online by mutableStateOf(false)
    var locked by mutableStateOf(true)
    var engine by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var scanning by mutableStateOf(false)
    var message by mutableStateOf("")
    val found = mutableStateListOf<Pair<String, String>>()   // (이름, MAC)

    // 근접(거리) 기능
    var autoUnlock by mutableStateOf(false)
    var walkAwayLock by mutableStateOf(false)
    var rssi by mutableStateOf<Int?>(null)     // 평활화된 신호세기(표시용)
    val isCalibrated: Boolean get() = proxNear != null

    private var pwd = "000000"
    private var mac: String? = null
    private var proxNear: Int? = null
    private var proxFar: Int? = null
    private var rssiAvg: Double? = null
    private var proxZone: String? = null

    private val main = Handler(Looper.getMainLooper())
    private val btm by lazy { ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager }
    private var gatt: BluetoothGatt? = null
    private var evtChar: BluetoothGattCharacteristic? = null
    private var cmdChar: BluetoothGattCharacteristic? = null
    private val writeQ = ArrayDeque<ByteArray>()
    private var writing = false

    private val prefs = ctx.getSharedPreferences("caronwatch", Context.MODE_PRIVATE)

    init { load() }

    private fun load() {
        mode = prefs.getString("mode", "demo") ?: "demo"
        name = prefs.getString("name", "내 차") ?: "내 차"
        pwd = prefs.getString("pwd", "000000") ?: "000000"
        mac = prefs.getString("mac", null)
        autoUnlock = prefs.getBoolean("autoUnlock", false)
        walkAwayLock = prefs.getBoolean("walkAway", false)
        proxNear = prefs.getInt("pnear", 1).takeIf { it != 1 }
        proxFar = prefs.getInt("pfar", 1).takeIf { it != 1 }
    }
    private fun saveCfg() {
        prefs.edit().putString("mode", mode).putString("name", name)
            .putString("pwd", pwd).putString("mac", mac)
            .putBoolean("autoUnlock", autoUnlock).putBoolean("walkAway", walkAwayLock)
            .putInt("pnear", proxNear ?: 1).putInt("pfar", proxFar ?: 1).apply()
    }
    private fun ui(block: () -> Unit) = main.post(block)
    private fun toast(m: String) = ui { message = m }

    // ---- 공개 API ----
    fun setDemo() {
        disconnect()
        mode = "demo"; mac = null; locked = true; engine = false; saveCfg()
        online = true
    }

    /** MP686 등록 1단계: 비밀번호를 정하고 주변 기기를 스캔 (크라운처럼 서비스 필터 없이 전체) */
    fun registerMp(password: String) {
        pwd = password.ifEmpty { "000000" }
        mode = "mp686"
        disconnect()
        startScan()
    }

    /** MP686 등록 2단계: 목록에서 고른 기기로 연결 */
    fun pickFound(nm: String, addr: String) {
        stopScan()
        name = nm; mac = addr; mode = "mp686"; saveCfg()
        connectSaved()
    }

    fun rescan() { if (mode == "mp686") startScan() }

    // ---- 근접(거리) ----
    fun setAutoUnlock(v: Boolean) { autoUnlock = v; saveCfg(); proxZone = null; if (v) startRssiPoll() }
    fun setWalkAway(v: Boolean) { walkAwayLock = v; saveCfg(); proxZone = null; if (v) startRssiPoll() }
    fun calibrate(): Boolean {
        val a = rssi ?: return false
        proxNear = a; proxFar = a - 12; saveCfg(); proxZone = null
        toast("보정 완료 · 기준 ${a}dBm")
        return true
    }
    fun clearCalib() { proxNear = null; proxFar = null; saveCfg(); proxZone = null; toast("보정을 초기화했어요") }

    private val rssiPoll = object : Runnable {
        override fun run() {
            val g = gatt
            if (g != null && online) {
                if (!writing) try { g.readRemoteRssi() } catch (_: Exception) {}   // 쓰는 중엔 건너뜀(충돌 방지)
                main.postDelayed(this, 2000)
            }
        }
    }
    private fun startRssiPoll() { main.removeCallbacks(rssiPoll); if (gatt != null && online) main.post(rssiPoll) }
    private fun stopRssiPoll() { main.removeCallbacks(rssiPoll); rssiAvg = null; rssi = null; proxZone = null }
    private fun evalProximity() {
        if (!autoUnlock && !walkAwayLock) { proxZone = null; return }
        val avg = rssi ?: return
        val near = proxNear ?: -72
        val far = proxFar ?: -88
        val zone = if (avg >= near) "near" else if (avg <= far) "far" else proxZone
        if (proxZone == null) { proxZone = zone; return }   // 첫 측정은 기준만
        if (zone != null && zone != proxZone) {
            if (zone == "near" && autoUnlock && locked) send(UNLOCK)
            else if (zone == "far" && walkAwayLock && !locked && !engine) send(LOCK)
            proxZone = zone
        }
    }

    fun connectSaved() {
        if (mode == "demo") { online = true; return }
        val m = mac ?: return
        busy = true
        try {
            val dev = btm.adapter.getRemoteDevice(m)
            gatt = dev.connectGatt(ctx, false, gattCb, BluetoothDevice.TRANSPORT_LE)
        } catch (e: Exception) { busy = false; toast("연결 실패: ${e.message}") }
    }

    fun disconnect() {
        stopRssiPoll()
        try { gatt?.disconnect(); gatt?.close() } catch (_: Exception) {}
        gatt = null; evtChar = null; cmdChar = null; writeQ.clear(); writing = false
        if (mode != "demo") online = false
    }

    fun send(cmd: Int) {
        if (busy) return
        if (mode == "demo") { demoSend(cmd); return }
        if (gatt == null || cmdChar == null) { toast("연결 안 됨"); connectSaved(); return }
        enqueue(frame(intArrayOf(0xCD, 0x0D, cmd)))
    }

    // ---- 스캔 ----
    private val scanner get() = btm.adapter.bluetoothLeScanner
    private val scanCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val nm = (result.device.name ?: result.scanRecord?.deviceName)?.trim()
            if (nm.isNullOrEmpty()) return                 // 이름 있는 기기만 (크라운과 동일)
            val addr = result.device.address
            ui { if (found.none { it.second == addr }) found.add(nm to addr) }
        }
        override fun onScanFailed(errorCode: Int) { ui { scanning = false; toast("스캔 실패 ($errorCode)") } }
    }
    private fun startScan() {
        val s = scanner ?: run { toast("블루투스를 켜주세요"); return }
        found.clear(); scanning = true
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try { s.startScan(null, settings, scanCb) } catch (e: Exception) { scanning = false; toast("스캔 불가: ${e.message}") }
        main.postDelayed({ stopScan() }, 8000)
    }
    private fun stopScan() {
        if (!scanning) return
        scanning = false
        try { scanner?.stopScan(scanCb) } catch (_: Exception) {}
    }

    // ---- GATT ----
    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                g.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                ui { online = false; busy = false }
                try { g.close() } catch (_: Exception) {}
                if (gatt === g) gatt = null
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val svc = g.getService(MP_SVC) ?: run { ui { busy = false; toast("서비스 없음") }; return }
            cmdChar = svc.getCharacteristic(MP_CMD)
            evtChar = svc.getCharacteristic(MP_EVT)
            val evt = evtChar ?: run { ui { busy = false; toast("알림 특성 없음") }; return }
            g.setCharacteristicNotification(evt, true)
            val cccd = evt.getDescriptor(CCCD)
            if (cccd != null) writeDescriptor(g, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            else loginMp()
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            loginMp()
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            writing = false; drain()
        }
        override fun onReadRemoteRssi(g: BluetoothGatt, rssiVal: Int, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            ui {
                rssiAvg = if (rssiAvg == null) rssiVal.toDouble() else rssiAvg!! * 0.5 + rssiVal * 0.5
                rssi = Math.round(rssiAvg!!).toInt()
                evalProximity()
            }
        }
        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            handleRx(c.value ?: return)
        }
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            handleRx(value)
        }
    }

    private fun loginMp() {
        enqueue(loginPacket(pwd))
    }

    private fun handleRx(raw: ByteArray) {
        val b = IntArray(raw.size) { raw[it].toInt() and 0xFF }
        if (b.isEmpty() || b[0] != 0xCD || b.size < 3) return
        ui {
            when (b[1]) {
                0x0A -> { // 로그인 응답
                    if (b[2] == 0) {
                        online = true; busy = false
                        if (b.size >= 4) locked = when (b[3]) { 0xA1 -> true; 0xA2 -> false; else -> locked }
                        if (autoUnlock || walkAwayLock) startRssiPoll()
                    } else { toast("비밀번호가 맞지 않아요"); busy = false; disconnect() }
                }
                0x0D -> if (b.size >= 4 && b[3] == 0) when (b[2]) {
                    LOCK -> locked = true; UNLOCK -> locked = false
                    START -> engine = true; STOP -> engine = false
                }
                0x0E -> toast("경보: ${WARN[b.getOrElse(2){0}] ?: "경보"}")
                0xA1 -> engine = (b.getOrElse(2){0} != 0)
            }
        }
    }

    // ---- 쓰기 큐 ----
    private fun enqueue(bytes: ByteArray) { writeQ.add(bytes); drain() }
    private fun drain() {
        if (writing) return
        val g = gatt ?: return
        val c = cmdChar ?: return
        val next = writeQ.poll() ?: return
        writing = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeCharacteristic(c, next, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        } else {
            @Suppress("DEPRECATION") run { c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT; c.value = next; g.writeCharacteristic(c) }
        }
    }
    private fun writeDescriptor(g: BluetoothGatt, d: BluetoothGattDescriptor, value: ByteArray) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeDescriptor(d, value)
        else { @Suppress("DEPRECATION") run { d.value = value; g.writeDescriptor(d) } }
    }

    // ---- 패킷 ----
    private fun sum(a: IntArray): Int { var s = 0; for (x in a) s = (s + x) and 0xFF; return s }
    private fun frame(a: IntArray): ByteArray {
        val out = IntArray(a.size + 1); System.arraycopy(a, 0, out, 0, a.size); out[a.size] = sum(a)
        return ByteArray(out.size) { out[it].toByte() }
    }
    private fun loginPacket(p: String): ByteArray {
        val a = IntArray(9); a[0] = 0xCD; a[1] = 0x0A; a[2] = 0
        for (i in 0 until 6) a[3 + i] = if (i < p.length) p[i].code and 0xFF else 0
        return frame(a)
    }

    // ---- 데모 ----
    private fun demoSend(cmd: Int) {
        busy = true
        main.postDelayed({
            when (cmd) { LOCK -> locked = true; UNLOCK -> locked = false; START -> engine = true; STOP -> engine = false }
            busy = false
        }, 300)
    }
}
