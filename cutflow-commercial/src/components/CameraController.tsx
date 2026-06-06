import {Node, NodeProps} from '@motion-canvas/2d';
import {SimpleSignal, createSignal, Vector2, all, easeInOutCubic} from '@motion-canvas/core';

export interface CameraControllerProps extends NodeProps {
  initialZoom?: number;
  initialPosition?: Vector2;
  initialRotation?: number;
}

export class CameraController extends Node {
  public readonly zoom: SimpleSignal<number, this>;
  public readonly cameraPosition: SimpleSignal<Vector2, this>;
  public readonly cameraRotation: SimpleSignal<number, this>;

  public constructor(props: CameraControllerProps) {
    super(props);
    this.zoom = createSignal(props.initialZoom ?? 1);
    this.cameraPosition = createSignal(props.initialPosition ?? Vector2.zero);
    this.cameraRotation = createSignal(props.initialRotation ?? 0);

    // Apply camera transformations in reverse to the container
    this.scale(() => this.zoom());
    this.position(() => this.cameraPosition().mul(-this.zoom()));
    this.rotation(() => -this.cameraRotation());
  }

  /**
   * Smoothly pans, zooms, and rotates the camera to a target configuration.
   */
  public *panTo(
    targetPos: Vector2 | {x: number; y: number},
    targetZoom: number,
    duration: number,
    targetRot = 0,
    ease = easeInOutCubic
  ) {
    const targetVec = targetPos instanceof Vector2 ? targetPos : new Vector2(targetPos.x, targetPos.y);
    yield* all(
      this.cameraPosition(targetVec, duration, ease),
      this.zoom(targetZoom, duration, ease),
      this.cameraRotation(targetRot, duration, ease)
    );
  }
}
