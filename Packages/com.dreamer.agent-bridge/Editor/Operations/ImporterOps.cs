using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    /// <summary>Generic AssetImporter field setter — TextureImporter / ModelImporter / AudioImporter / etc. Closes the gap that set-property only reaches the runtime asset, not its importer.</summary>
    public static class ImporterOps
    {
        public static CommandResult SetImportProperty(Dictionary<string, object> args)
        {
            string assetPath = AssetOps.ResolveAssetPath(args);
            if (assetPath == null)
                return CommandResult.Fail("Provide 'assetPath' or 'guid'.");

            string propertyName = SimpleJson.GetString(args, "propertyName");
            if (string.IsNullOrEmpty(propertyName))
                return CommandResult.Fail("'propertyName' is required (e.g. 'spritePixelsPerUnit', 'filterMode', 'textureType').");

            var importer = AssetImporter.GetAtPath(assetPath);
            if (importer == null)
                return CommandResult.Fail($"No AssetImporter for {assetPath}");

            object value = SimpleJson.GetValue(args, "value");

            var importerType = importer.GetType();
            var prop = importerType.GetProperty(propertyName,
                BindingFlags.Public | BindingFlags.Instance);

            if (prop == null || !prop.CanWrite)
            {
                var available = importerType.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                    .Where(p => p.CanWrite && p.CanRead)
                    .Select(p => $"{p.Name}:{p.PropertyType.Name}")
                    .OrderBy(s => s)
                    .ToArray();
                return CommandResult.Fail(
                    $"Property '{propertyName}' not found (or read-only) on {importerType.Name}. " +
                    $"Available writable: {string.Join(", ", available)}");
            }

            object oldValue = prop.GetValue(importer);
            object newValue;
            try { newValue = ConvertValue(value, prop.PropertyType); }
            catch (Exception ex)
            {
                return CommandResult.Fail($"Failed to convert value for {prop.PropertyType.Name}: {ex.Message}");
            }

            try { prop.SetValue(importer, newValue); }
            catch (Exception ex)
            {
                return CommandResult.Fail($"Failed to set {propertyName}: {ex.Message}");
            }

            importer.SaveAndReimport();

            return CommandResult.Ok(SimpleJson.Object()
                .Put("set", true)
                .Put("assetPath", assetPath)
                .Put("importer", importerType.Name)
                .Put("property", propertyName)
                .Put("propertyType", prop.PropertyType.Name)
                .Put("oldValue", oldValue?.ToString() ?? "null")
                .Put("newValue", newValue?.ToString() ?? "null")
                .ToString());
        }

        static object ConvertValue(object value, Type targetType)
        {
            if (value == null)
            {
                if (targetType.IsValueType && Nullable.GetUnderlyingType(targetType) == null)
                    throw new ArgumentException($"Cannot assign null to non-nullable {targetType.Name}");
                return null;
            }

            if (targetType.IsEnum)
            {
                if (value is string s) return Enum.Parse(targetType, s, ignoreCase: true);
                if (value is int || value is long || value is double)
                    return Enum.ToObject(targetType, Convert.ToInt32(value));
                throw new ArgumentException($"Enum '{targetType.Name}' expects a name string or integer, got {value.GetType().Name}");
            }

            if (targetType == typeof(Vector2)) return ParseVector2(value);
            if (targetType == typeof(Vector3)) return ParseVector3(value);
            if (targetType == typeof(Vector4)) return ParseVector4(value);

            if (targetType == typeof(string)) return value.ToString();

            return Convert.ChangeType(value, targetType, System.Globalization.CultureInfo.InvariantCulture);
        }

        static Vector2 ParseVector2(object raw)
        {
            if (raw is List<object> list && list.Count >= 2)
                return new Vector2(ToFloat(list[0]), ToFloat(list[1]));
            if (raw is Dictionary<string, object> obj)
                return new Vector2(SimpleJson.GetFloat(obj, "x"), SimpleJson.GetFloat(obj, "y"));
            throw new ArgumentException("Vector2 expects [x,y] or {x,y}.");
        }

        static Vector3 ParseVector3(object raw)
        {
            if (raw is List<object> list && list.Count >= 3)
                return new Vector3(ToFloat(list[0]), ToFloat(list[1]), ToFloat(list[2]));
            if (raw is Dictionary<string, object> obj)
                return new Vector3(SimpleJson.GetFloat(obj, "x"), SimpleJson.GetFloat(obj, "y"), SimpleJson.GetFloat(obj, "z"));
            throw new ArgumentException("Vector3 expects [x,y,z] or {x,y,z}.");
        }

        static Vector4 ParseVector4(object raw)
        {
            if (raw is List<object> list && list.Count >= 4)
                return new Vector4(ToFloat(list[0]), ToFloat(list[1]), ToFloat(list[2]), ToFloat(list[3]));
            if (raw is Dictionary<string, object> obj)
                return new Vector4(SimpleJson.GetFloat(obj, "x"), SimpleJson.GetFloat(obj, "y"), SimpleJson.GetFloat(obj, "z"), SimpleJson.GetFloat(obj, "w"));
            throw new ArgumentException("Vector4 expects [x,y,z,w] or {x,y,z,w}.");
        }

        static float ToFloat(object o)
        {
            if (o is double d) return (float)d;
            if (o is int i) return i;
            if (o is long l) return l;
            if (o is float f) return f;
            return 0f;
        }
    }
}
