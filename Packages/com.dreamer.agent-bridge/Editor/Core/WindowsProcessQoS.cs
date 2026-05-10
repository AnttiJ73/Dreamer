using System;
using System.Runtime.InteropServices;

namespace Dreamer.AgentBridge
{
    /// <summary>
    /// Opts the Unity Editor process out of Windows EcoQoS power throttling.
    /// Without this, Win11 22H2+ aggressively suspends background-thread Timers
    /// on unfocused processes — heartbeat ticks slip past the daemon's timeout
    /// and the bridge appears disconnected even though nothing has actually
    /// crashed. The fix is Unity-version-independent (kernel32 only).
    /// </summary>
    public static class WindowsProcessQoS
    {
        // ProcessInformationClass enum value for ProcessPowerThrottling.
        const int ProcessPowerThrottling = 4;

        // PROCESS_POWER_THROTTLING_EXECUTION_SPEED — controls CPU EcoQoS hint.
        const uint PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;
        const uint PROCESS_POWER_THROTTLING_CURRENT_VERSION = 0x1;

        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_POWER_THROTTLING_STATE
        {
            public uint Version;
            public uint ControlMask;
            public uint StateMask;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetProcessInformation(
            IntPtr hProcess,
            int ProcessInformationClass,
            ref PROCESS_POWER_THROTTLING_STATE ProcessInformation,
            int ProcessInformationSize);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetCurrentProcess();

        static bool _applied;

        /// <summary>Idempotent: opt the current process out of EcoQoS. Returns true on success or no-op.</summary>
        public static bool DisableEcoQoSForCurrentProcess()
        {
#if UNITY_EDITOR_WIN
            if (_applied) return true;
            try
            {
                var info = new PROCESS_POWER_THROTTLING_STATE
                {
                    Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                    ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
                    StateMask = 0, // explicit opt-out
                };
                int size = Marshal.SizeOf(info);
                bool ok = SetProcessInformation(GetCurrentProcess(), ProcessPowerThrottling, ref info, size);
                _applied = ok;
                if (!ok)
                {
                    int err = Marshal.GetLastWin32Error();
                    DreamerLog.Warn($"SetProcessInformation(ProcessPowerThrottling) failed (Win32 err {err}). Background timers may be throttled when Unity is unfocused.");
                }
                return ok;
            }
            catch (DllNotFoundException)
            {
                // Pre-1709 Windows — silently no-op.
                return false;
            }
            catch (EntryPointNotFoundException)
            {
                return false;
            }
            catch (Exception ex)
            {
                DreamerLog.Warn($"WindowsProcessQoS opt-out threw: {ex.Message}");
                return false;
            }
#else
            return false;
#endif
        }
    }
}
