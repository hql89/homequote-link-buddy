-- Set existing verticals to inactive
UPDATE public.verticals SET is_active = false;

-- Insert the new tree_service vertical
INSERT INTO public.verticals (
  slug,
  label,
  professional_label,
  professional_label_plural,
  service_types,
  is_active,
  sort_order,
  icon_name,
  hero_title
) VALUES (
  'tree-service',
  'Tree Service & Removal',
  'tree service pro',
  'tree service pros',
  ARRAY[
    'Emergency Tree Removal',
    'Precision Trimming & Pruning',
    'Stump Grinding & Root Removal',
    'Hillside Brush Clearing',
    'Palm Tree Skinning',
    'Arborist Consultation',
    'Other'
  ],
  true,
  1,
  'TreePine',
  'Expert Tree Service & Removal'
)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  service_types = EXCLUDED.service_types,
  is_active = true;
