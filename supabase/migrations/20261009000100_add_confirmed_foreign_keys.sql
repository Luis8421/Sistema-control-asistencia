-- Add relationships confirmed by the application owner.
-- Run after 20261009000000_create_control_asistencia.sql and before importing data.
-- The departamentos/employees dependency cycle must be deferred during import.
BEGIN;

ALTER TABLE public.empleados
  DROP CONSTRAINT empleados_departamento_id_fkey,
  ADD CONSTRAINT empleados_departamento_id_fkey
    FOREIGN KEY (departamento_id)
    REFERENCES public.departamentos (id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.departamentos
  ADD CONSTRAINT departamentos_supervisor_id_fkey
    FOREIGN KEY (supervisor_id)
    REFERENCES public.empleados (id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.empleados
  ADD CONSTRAINT empleados_supervisor_id_fkey
    FOREIGN KEY (supervisor_id)
    REFERENCES public.empleados (id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.empleado_horario
  ADD CONSTRAINT empleado_horario_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.usuarios (id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.asistencias
  ADD CONSTRAINT asistencias_aprobado_por_fkey
    FOREIGN KEY (aprobado_por)
    REFERENCES public.usuarios (id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.incidencias
  ADD CONSTRAINT incidencias_revisado_por_fkey
    FOREIGN KEY (revisado_por)
    REFERENCES public.usuarios (id)
    DEFERRABLE INITIALLY DEFERRED;

COMMIT;
