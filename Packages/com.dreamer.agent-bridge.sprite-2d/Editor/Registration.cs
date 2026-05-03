using System;
using System.Collections.Generic;
using Dreamer.AgentBridge;

namespace Dreamer.AgentBridge.Sprite2D
{
    /// <summary>Registration entry — core's CommandDispatcher reflection-loads any Dreamer.AgentBridge.*.Registration and calls Register.</summary>
    public static class Registration
    {
        public static void Register(Dictionary<string, Func<Dictionary<string, object>, CommandResult>> handlers)
        {
            if (handlers == null) return;
            handlers["preview_sprite"] = SpriteOps.PreviewSprite;
            handlers["slice_sprite"]   = SpriteOps.SliceSprite;
        }
    }
}
