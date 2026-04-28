using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Configure a RectTransform via named anchor preset + size + pivot in one call.</summary>
    public static class UIRectOps
    {
        /// <summary>Apply anchor/size/pivot/offset args to a scene or prefab RectTransform.</summary>
        public static CommandResult SetRectTransform(Dictionary<string, object> args)
        {
            string sceneObjectPath = SimpleJson.GetString(args, "sceneObjectPath");
            if (!string.IsNullOrEmpty(sceneObjectPath))
            {
                var go = PropertyOps.FindSceneObject(sceneObjectPath, out string findErr);
                if (go == null) return CommandResult.Fail(findErr ?? $"Scene object not found: {sceneObjectPath}");
                var rt = go.GetComponent<RectTransform>();
                if (rt == null) return CommandResult.Fail($"'{go.name}' has no RectTransform — is this a UI GameObject?");
                string err = UIHelpers.ApplyRectTransformArgs(rt, args);
                if (err != null) return CommandResult.Fail(err);
                EditorUtility.SetDirty(go);
                return OkResult(sceneObjectPath, null, null, rt);
            }

            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'sceneObjectPath', 'assetPath', or 'guid'.");
            if (!assetPath.EndsWith(".prefab", System.StringComparison.OrdinalIgnoreCase))
                return CommandResult.Fail($"Asset is not a prefab: {assetPath}");

            string childPath = SimpleJson.GetString(args, "childPath");
            var prefabRoot = PrefabUtility.LoadPrefabContents(assetPath);
            if (prefabRoot == null) return CommandResult.Fail($"Failed to load prefab: {assetPath}");

            try
            {
                GameObject target = prefabRoot;
                if (!string.IsNullOrEmpty(childPath))
                {
                    var child = prefabRoot.transform.Find(childPath);
                    if (child == null) return CommandResult.Fail($"Child '{childPath}' not found in prefab.");
                    target = child.gameObject;
                }

                var rt = target.GetComponent<RectTransform>();
                if (rt == null) return CommandResult.Fail($"'{target.name}' has no RectTransform.");
                string err = UIHelpers.ApplyRectTransformArgs(rt, args);
                if (err != null) return CommandResult.Fail(err);

                PrefabUtility.SaveAsPrefabAsset(prefabRoot, assetPath);
                return OkResult(null, assetPath, childPath, rt);
            }
            finally
            {
                PrefabOps.SafeUnloadPrefabContents(prefabRoot);
            }
        }

        static CommandResult OkResult(string sceneObjectPath, string assetPath, string childPath, RectTransform rt)
        {
            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("sceneObjectPath", sceneObjectPath)
                .Put("assetPath", assetPath)
                .Put("childPath", childPath)
                .PutRaw("anchorMin", Vector2Json(rt.anchorMin))
                .PutRaw("anchorMax", Vector2Json(rt.anchorMax))
                .PutRaw("pivot", Vector2Json(rt.pivot))
                .PutRaw("sizeDelta", Vector2Json(rt.sizeDelta))
                .PutRaw("anchoredPosition", Vector2Json(rt.anchoredPosition))
                .ToString());
        }

        static string Vector2Json(Vector2 v) =>
            SimpleJson.Object().Put("x", v.x).Put("y", v.y).ToString();
    }
}
