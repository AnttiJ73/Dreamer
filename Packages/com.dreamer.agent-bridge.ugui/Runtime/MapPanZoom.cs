using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Dreamer.AgentBridge.UGUI
{
    /// <summary>
    /// Runtime mouse-wheel zoom for any ScrollRect. Pan is handled by ScrollRect's
    /// built-in drag; this adds the missing zoom step.
    ///
    /// Attach to the same GameObject as a ScrollRect. Implements IScrollHandler so
    /// EventSystem dispatches mouse wheel input here, and scales the ScrollRect's
    /// Content RectTransform proportionally (clamped between minZoom..maxZoom).
    ///
    /// Auto-attached by UIWidgetOps.CreateScrollList when the spec has
    /// `mapPanZoom: true`. Standalone use: just AddComponent on any ScrollRect.
    /// </summary>
    [RequireComponent(typeof(ScrollRect))]
    public class MapPanZoom : UIBehaviour, IScrollHandler
    {
        [Tooltip("Per-notch zoom factor. 0.1 = each scroll multiplies/divides scale by 1.1. " +
                 "Multiplicative (not additive) so the perceived zoom rate is consistent " +
                 "across the whole zoom range — linear feels wrong (slow when zoomed in, " +
                 "fast and snappy when zoomed out near min).")]
        public float zoomSpeed = 0.1f;

        [Tooltip("Minimum allowed scale of the Content rect.")]
        public float minZoom = 0.25f;

        [Tooltip("Maximum allowed scale of the Content rect.")]
        public float maxZoom = 4.0f;

        ScrollRect _scrollRect;
        float _originalSensitivity;

        protected override void Awake()
        {
            base.Awake();
            _scrollRect = GetComponent<ScrollRect>();
            // Disable ScrollRect wheel-scrolling when this zoomer is attached. Otherwise
            // every wheel notch both scrolls AND zooms, which feels broken. Drag-to-pan
            // is still active because it goes through OnDrag, not OnScroll/scrollSensitivity.
            if (_scrollRect != null)
            {
                _originalSensitivity = _scrollRect.scrollSensitivity;
                _scrollRect.scrollSensitivity = 0f;
            }
        }

        protected override void OnDestroy()
        {
            base.OnDestroy();
            if (_scrollRect != null) _scrollRect.scrollSensitivity = _originalSensitivity;
        }

        public void OnScroll(PointerEventData eventData)
        {
            if (_scrollRect == null || _scrollRect.content == null) return;

            float scrollDelta = eventData.scrollDelta.y;
            if (Mathf.Approximately(scrollDelta, 0)) return;

            // Multiplicative zoom: scale *= (1 + zoomSpeed)^scrollDelta. Each notch moves
            // the same FRACTION of current scale, which matches user intuition. Linear
            // (scale + N) felt wrong: at scale 0.3, a single notch flipped to min; at
            // scale 3.0, twenty notches barely moved.
            float currentScale = _scrollRect.content.localScale.x;
            float zoomFactor = Mathf.Pow(1f + zoomSpeed, scrollDelta);
            float newScale = Mathf.Clamp(currentScale * zoomFactor, minZoom, maxZoom);
            if (Mathf.Approximately(newScale, currentScale)) return;

            // Anchor the zoom around the cursor so the point under the mouse stays under
            // the mouse — feels much more natural than zooming from content origin.
            var content = _scrollRect.content;
            RectTransformUtility.ScreenPointToLocalPointInRectangle(
                content, eventData.position, eventData.pressEventCamera, out Vector2 cursorLocalBefore);

            content.localScale = new Vector3(newScale, newScale, 1f);

            RectTransformUtility.ScreenPointToLocalPointInRectangle(
                content, eventData.position, eventData.pressEventCamera, out Vector2 cursorLocalAfter);

            // Move content so the same local point lands under the cursor again.
            Vector2 worldShift = (cursorLocalAfter - cursorLocalBefore) * newScale;
            content.anchoredPosition += worldShift;
        }
    }
}
