using System;
using System.Collections.Generic;
using Dreamer.AgentBridge;

namespace Dreamer.AgentBridge.FX
{
    public static class Registration
    {
        public static void Register(Dictionary<string, Func<Dictionary<string, object>, CommandResult>> handlers)
        {
            if (handlers == null) return;
            handlers["capture_particle"] = ParticleCaptureOps.CaptureParticle;
        }
    }
}
