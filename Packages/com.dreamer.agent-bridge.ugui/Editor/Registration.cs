using System;
using System.Collections.Generic;

namespace Dreamer.AgentBridge.UGUI
{
    /// <summary>Registration entry point — core's CommandDispatcher scans for Dreamer.AgentBridge.*.Registration types and calls Register.</summary>
    public static class Registration
    {
        public static void Register(Dictionary<string, Func<Dictionary<string, object>, CommandResult>> handlers)
        {
            if (handlers == null) return;

            handlers["create_ui_tree"]      = UITreeOps.CreateUITree;
            handlers["inspect_ui_tree"]     = UIInspectOps.InspectUITree;
            handlers["set_rect_transform"]  = UIRectOps.SetRectTransform;
        }
    }
}
