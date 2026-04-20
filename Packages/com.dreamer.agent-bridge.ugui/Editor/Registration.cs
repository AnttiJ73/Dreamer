using System;
using System.Collections.Generic;

namespace Dreamer.AgentBridge.UGUI
{
    /// <summary>
    /// Registration entry point for the UGUI add-on.
    ///
    /// Core Dreamer's <c>CommandDispatcher</c> scans every loaded assembly for
    /// types matching <c>Dreamer.AgentBridge.*.Registration</c> and invokes
    /// their static <c>Register</c> method with the handler dictionary.
    /// That's the only contract between core and this add-on — core doesn't
    /// reference anything in this package, so users who don't install the
    /// add-on compile and run cleanly with core alone.
    ///
    /// Only three commands are exposed publicly:
    ///   - create_ui_tree   (primary declarative builder)
    ///   - inspect_ui_tree  (round-trip inspection)
    ///   - set_rect_transform (single-element tweaker)
    ///
    /// The Tier-2 widget primitives (UIWidgetOps.CreatePanel / CreateButton /
    /// CreateSlider / etc.) stay as internal C# helpers called by
    /// UITreeOps — not exposed to the agent API. This keeps Claude's
    /// context model focused on ONE powerful tree-builder command rather
    /// than twelve overlapping primitives.
    /// </summary>
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
