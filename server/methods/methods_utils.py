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


@dataclass
class DerivedObjects_ClientState:
    base_image_id_map: dict = field(init=False, default_factory=dict)
    derived_image_ids: set = field(init=False, default_factory=set)
    derived_overlay_ids: set = field(init=False, default_factory=set)


class DerivedObjects_ClientStateManager:
    state = DerivedObjects_ClientState

    def associate_derived_image(state, image_id, derived_image_id):
        state.derived_image_ids.add(derived_image_id)
        state.base_image_id_map[derived_image_id] = image_id

    def associate_derived_overlay(state, image_id, derived_overlay_id):
        state.derived_overlay_ids.add(derived_overlay_id)
        state.base_image_id_map[derived_overlay_id] = image_id

    def get_base_image(state: DerivedObjects_ClientState, object_id: str) -> str:
        if (
            object_id in state.derived_image_ids
            or object_id in state.derived_overlay_ids
        ):
            return state.base_image_id_map[object_id]
        return object_id

    def get_derived_image_ids(state: DerivedObjects_ClientState, image_id: str) -> set:
        derived_image_ids = [
            derived_id
            for derived_id, parent_id in state.derived_image_ids.items()
            if parent_id == image_id
        ]
        return derived_image_ids

    def get_derived_overlay_ids(
        state: DerivedObjects_ClientState, image_id: str
    ) -> set:
        derived_overlay_ids = [
            derived_id
            for derived_id, parent_id in state.derived_overlay_ids.items()
            if parent_id == image_id
        ]
        return derived_overlay_ids
