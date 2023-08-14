from typing import Dict

from dataclasses import (
    dataclass,
    field,
)

from volview_server import (
    get_current_client_store,
    get_current_session,
)


async def show_image(image_id: str):
    store = get_current_client_store("dataset")
    await store.setPrimarySelection({"type": "image", "dataID": image_id})


class CommonClientState:
    def __init__(self):
        self.base_image_id_map = dict()
        self.derived_image_ids = set()
        self.derived_overlay_ids = set()
        self.current_image = dict()
        self.current_image_id = None
        self.current_overlay = dict()
        self.current_overlay_id = None

    def set_current_image(self, image_id, image):
        self.current_image = image
        self.current_image_id = image_id

    def set_current_overlay(self, overlay_id, overlay):
        self.current_overlay = overlay
        self.current_overlay_it = overlay_id

    def associate_derived_image(self, image_id, derived_image_id):
        self.derived_image_ids.add(derived_image_id)
        self.base_image_id_map[derived_image_id] = image_id

    def associate_derived_overlay(self, image_id, derived_overlay_id):
        self.derived_overlay_ids.add(derived_overlay_id)
        self.base_image_id_map[derived_overlay_id] = image_id

    def get_base_image(self, object_id: str) -> str:
        if object_id in self.derived_image_ids or object_id in self.derived_overlay_ids:
            return self.base_image_id_map[object_id]
        return object_id

    def get_derived_image_ids(self, image_id: str) -> set:
        derived_image_ids = [
            derived_id
            for derived_id, parent_id in self.derived_image_ids.items()
            if parent_id == image_id
        ]
        return derived_image_ids

    def get_derived_overlay_ids(self, image_id: str) -> set:
        derived_overlay_ids = [
            derived_id
            for derived_id, parent_id in self.derived_overlay_ids.items()
            if parent_id == image_id
        ]
        return derived_overlay_ids
