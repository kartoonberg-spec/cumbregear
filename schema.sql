-- ══════════════════════════════════════════════════════════
--  CumbreGear — Schema Supabase
--  Ejecutar en: Supabase > SQL Editor > New query
--  Orden de ejecución: tablas → funciones → políticas RLS
-- ══════════════════════════════════════════════════════════


-- ── 1. SUSCRIPTORES NEWSLETTER ─────────────────────────────
CREATE TABLE IF NOT EXISTS suscriptores (
  id             BIGSERIAL     PRIMARY KEY,
  email          TEXT          NOT NULL UNIQUE,
  fuente         TEXT          DEFAULT 'newsletter_web',
  activo         BOOLEAN       DEFAULT TRUE,
  fecha_registro TIMESTAMPTZ   DEFAULT NOW()
);

-- Índice para consultas por email
CREATE INDEX IF NOT EXISTS idx_suscriptores_email ON suscriptores(email);


-- ── 2. VISITAS POR ARTÍCULO ────────────────────────────────
CREATE TABLE IF NOT EXISTS visitas_articulos (
  id          BIGSERIAL   PRIMARY KEY,
  slug        TEXT        NOT NULL UNIQUE,  -- clave del artículo, ej: 'botas'
  visitas     BIGINT      DEFAULT 0,
  ultima_vista TIMESTAMPTZ DEFAULT NOW()
);

-- Función RPC para incremento atómico (evita race conditions)
CREATE OR REPLACE FUNCTION incrementar_visitas(p_slug TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO visitas_articulos (slug, visitas, ultima_vista)
    VALUES (p_slug, 1, NOW())
  ON CONFLICT (slug) DO UPDATE
    SET visitas      = visitas_articulos.visitas + 1,
        ultima_vista = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 3. VALORACIONES DE ARTÍCULOS ──────────────────────────
CREATE TABLE IF NOT EXISTS valoraciones (
  id            BIGSERIAL    PRIMARY KEY,
  articulo_slug TEXT         NOT NULL,
  puntuacion    SMALLINT     NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
  creado_en     TIMESTAMPTZ  DEFAULT NOW()
);

-- Índice para calcular medias rápido
CREATE INDEX IF NOT EXISTS idx_valoraciones_slug ON valoraciones(articulo_slug);

-- Función RPC para obtener media y total de votos
CREATE OR REPLACE FUNCTION media_valoraciones(p_slug TEXT)
RETURNS JSON AS $$
DECLARE
  v_media  NUMERIC;
  v_total  BIGINT;
BEGIN
  SELECT
    ROUND(AVG(puntuacion)::NUMERIC, 1),
    COUNT(*)
  INTO v_media, v_total
  FROM valoraciones
  WHERE articulo_slug = p_slug;

  RETURN json_build_object(
    'media', COALESCE(v_media, 0),
    'total', COALESCE(v_total, 0)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ══════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  Permite lectura pública y escritura desde el frontend
--  con la anon key. Los datos de admin se gestionan
--  desde el dashboard de Supabase o con service_role key.
-- ══════════════════════════════════════════════════════════

-- Activar RLS en todas las tablas
ALTER TABLE suscriptores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitas_articulos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE valoraciones        ENABLE ROW LEVEL SECURITY;

-- SUSCRIPTORES: solo INSERT público (no lectura de emails por seguridad)
CREATE POLICY "suscriptores_insert_public"
  ON suscriptores FOR INSERT
  TO anon
  WITH CHECK (true);

-- VISITAS: lectura y escritura pública (datos no sensibles)
CREATE POLICY "visitas_select_public"
  ON visitas_articulos FOR SELECT
  TO anon USING (true);

CREATE POLICY "visitas_insert_public"
  ON visitas_articulos FOR INSERT
  TO anon WITH CHECK (true);

CREATE POLICY "visitas_update_public"
  ON visitas_articulos FOR UPDATE
  TO anon USING (true);

-- VALORACIONES: insertar y leer públicamente
CREATE POLICY "valoraciones_select_public"
  ON valoraciones FOR SELECT
  TO anon USING (true);

CREATE POLICY "valoraciones_insert_public"
  ON valoraciones FOR INSERT
  TO anon WITH CHECK (true);


-- ══════════════════════════════════════════════════════════
--  VISTAS ÚTILES PARA EL PANEL DE ADMIN
-- ══════════════════════════════════════════════════════════

-- Vista: artículos ordenados por visitas
CREATE OR REPLACE VIEW v_articulos_populares AS
SELECT
  slug,
  visitas,
  ultima_vista
FROM visitas_articulos
ORDER BY visitas DESC;

-- Vista: media de valoraciones por artículo
CREATE OR REPLACE VIEW v_valoraciones_resumen AS
SELECT
  articulo_slug,
  ROUND(AVG(puntuacion)::NUMERIC, 2) AS media,
  COUNT(*) AS total_votos
FROM valoraciones
GROUP BY articulo_slug
ORDER BY media DESC;

-- Vista: suscriptores activos (solo para admin con service_role)
CREATE OR REPLACE VIEW v_suscriptores_activos AS
SELECT
  id,
  email,
  fuente,
  fecha_registro
FROM suscriptores
WHERE activo = TRUE
ORDER BY fecha_registro DESC;
