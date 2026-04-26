using System;
using System.Collections.Generic;

namespace Dreamer.AgentBridge.Animation
{
    /// <summary>
    /// Registration entry point for the Animation add-on.
    ///
    /// Core Dreamer's <c>CommandDispatcher</c> scans every loaded assembly for
    /// types matching <c>Dreamer.AgentBridge.*.Registration</c> and invokes
    /// their static <c>Register</c> method with the handler dictionary.
    /// That's the only contract between core and this add-on — core doesn't
    /// reference anything in this package, so users who don't install the
    /// add-on compile and run cleanly with core alone.
    ///
    /// Phase 1 surface (AnimationClip authoring):
    ///   - create_animation_clip      (new .anim asset)
    ///   - set_animation_curve        (write/replace one float curve binding)
    ///   - inspect_animation_clip     (list bindings + per-curve summary)
    ///   - sample_animation_curve     (return samples [{t,v}, ...] for agent
    ///                                 to verify the curve numerically)
    ///   - delete_animation_curve     (remove one binding)
    ///
    /// Phase 2 surface (AnimatorController authoring) is forthcoming.
    /// </summary>
    public static class Registration
    {
        public static void Register(Dictionary<string, Func<Dictionary<string, object>, CommandResult>> handlers)
        {
            if (handlers == null) return;

            handlers["create_animation_clip"]    = AnimationClipOps.CreateAnimationClip;
            handlers["set_animation_curve"]      = AnimationClipOps.SetAnimationCurve;
            handlers["inspect_animation_clip"]   = AnimationClipOps.InspectAnimationClip;
            handlers["sample_animation_curve"]   = AnimationClipOps.SampleAnimationCurve;
            handlers["delete_animation_curve"]   = AnimationClipOps.DeleteAnimationCurve;
        }
    }
}
