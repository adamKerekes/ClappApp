package expo.modules.obdbluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID

// Serial Port Profile: ezen beszél a legtöbb klasszikus Bluetooth ELM327 adapter.
private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

// Az ELM327 ezzel a karakterrel jelzi, hogy kész a következő parancsra.
private const val PROMPT = '>'.code

class BluetoothUnavailableException :
  CodedException("Ezen a telefonon nem érhető el a Bluetooth.")

class BluetoothDisabledException :
  CodedException("A Bluetooth ki van kapcsolva.")

class MissingPermissionException(cause: Throwable) :
  CodedException("Hiányzik a Bluetooth engedély (Közeli eszközök).", cause)

class ConnectFailedException(cause: Throwable?) :
  CodedException("Nem sikerült csatlakozni az adapterhez. Be van dugva és a gyújtás rá van adva?", cause)

class NotConnectedException :
  CodedException("Nincs kapcsolat az OBD adapterrel.")

class ConnectionLostException(cause: Throwable) :
  CodedException("Megszakadt a kapcsolat az adapterrel.", cause)

class CommandTimeoutException(command: String) :
  CodedException("Az adapter nem válaszolt időben erre: $command")

/**
 * Minimális Bluetooth Classic (SPP) híd az ELM327 OBD-II adapterekhez.
 * Kérés-válasz alapon működik: a parancsot `\r`-rel küldi, és a `>` promptig olvas.
 */
@SuppressLint("MissingPermission")
class ObdBluetoothModule : Module() {
  @Volatile
  private var socket: BluetoothSocket? = null

  private val adapter: BluetoothAdapter?
    get() {
      val context = appContext.reactContext ?: return null
      val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      return manager?.adapter
    }

  override fun definition() = ModuleDefinition {
    Name("ObdBluetooth")

    Function("isAvailable") {
      adapter != null
    }

    Function("isEnabled") {
      adapter?.isEnabled == true
    }

    Function("isConnected") {
      socket?.isConnected == true
    }

    AsyncFunction("getPairedDevices") {
      val bt = requireEnabledAdapter()
      try {
        bt.bondedDevices.map { device ->
          mapOf(
            "name" to (device.name ?: device.address),
            "address" to device.address
          )
        }
      } catch (e: SecurityException) {
        throw MissingPermissionException(e)
      }
    }

    AsyncFunction("connect") { address: String ->
      val bt = requireEnabledAdapter()
      closeSocket()
      try {
        // A futó eszközkeresés nagyon lelassítja a csatlakozást. Android 12+ alatt ehhez
        // BLUETOOTH_SCAN kellene, amit nem kérünk, ezért ott a hibát egyszerűen elnyeljük.
        bt.cancelDiscovery()
      } catch (ignored: SecurityException) {
      }
      val device = try {
        bt.getRemoteDevice(address)
      } catch (e: IllegalArgumentException) {
        throw ConnectFailedException(e)
      }
      socket = openSocket(device)
    }

    AsyncFunction("sendCommand") { command: String, timeoutMs: Int ->
      val current = socket ?: throw NotConnectedException()
      try {
        val input = current.inputStream
        val output = current.outputStream

        // Előző parancsból maradt bájtok eldobása.
        while (input.available() > 0) {
          input.read()
        }

        output.write("$command\r".toByteArray(Charsets.US_ASCII))
        output.flush()

        val response = StringBuilder()
        val buffer = ByteArray(256)
        val deadline = System.currentTimeMillis() + timeoutMs
        var done = false
        while (!done) {
          if (input.available() > 0) {
            val count = input.read(buffer)
            if (count < 0) {
              throw IOException("Stream closed")
            }
            for (i in 0 until count) {
              val byte = buffer[i].toInt() and 0xFF
              if (byte == PROMPT) {
                done = true
                break
              }
              response.append(byte.toChar())
            }
          } else {
            if (System.currentTimeMillis() > deadline) {
              throw CommandTimeoutException(command)
            }
            Thread.sleep(10)
          }
        }
        response.toString()
      } catch (e: IOException) {
        closeSocket()
        throw ConnectionLostException(e)
      }
    }

    Function("disconnect") {
      closeSocket()
    }

    OnDestroy {
      closeSocket()
    }
  }

  private fun requireEnabledAdapter(): BluetoothAdapter {
    val bt = adapter ?: throw BluetoothUnavailableException()
    if (!bt.isEnabled) {
      throw BluetoothDisabledException()
    }
    return bt
  }

  /**
   * Az olcsó klónok nem mind fogadják el a szabványos SPP kapcsolatot, ezért sorban
   * végigpróbáljuk a szokásos módokat.
   */
  private fun openSocket(device: BluetoothDevice): BluetoothSocket {
    val factories = listOf<() -> BluetoothSocket>(
      { device.createRfcommSocketToServiceRecord(SPP_UUID) },
      { device.createInsecureRfcommSocketToServiceRecord(SPP_UUID) },
      {
        device.javaClass
          .getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
          .invoke(device, 1) as BluetoothSocket
      }
    )

    var lastError: Throwable? = null
    for (factory in factories) {
      var candidate: BluetoothSocket? = null
      try {
        candidate = factory()
        candidate.connect()
        return candidate
      } catch (e: SecurityException) {
        throw MissingPermissionException(e)
      } catch (e: Exception) {
        lastError = e
        try {
          candidate?.close()
        } catch (ignored: IOException) {
        }
      }
    }
    throw ConnectFailedException(lastError)
  }

  private fun closeSocket() {
    val current = socket ?: return
    socket = null
    try {
      current.close()
    } catch (ignored: IOException) {
    }
  }
}
