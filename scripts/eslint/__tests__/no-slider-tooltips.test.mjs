import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import vueParser from 'vue-eslint-parser';
import rule from '../no-slider-tooltips.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser: vueParser } });
const template = (content) => `<template>${content}</template>`;

tester.run('no-slider-tooltips', rule, {
  valid: [
    template('<v-slider thumb-label="always" />'),
    template(
      '<div><v-slider :disabled="viewingCine" /><v-tooltip v-if="viewingCine" activator="parent">No segmentation</v-tooltip></div>'
    ),
    template(
      '<v-range-slider thumb-label><template #thumb-label="{ modelValue }">{{ modelValue }} µm</template></v-range-slider>'
    ),
    template(
      '<ReasonedAction :reason="reason"><v-slider :disabled="!!reason" /></ReasonedAction>'
    ),
    template(
      '<ReasonedAction :tooltip="undefined"><v-slider /></ReasonedAction>'
    ),
    template(
      '<div><ReasonedAction tooltip="Help"><v-btn icon="mdi-information" /></ReasonedAction><v-slider /></div>'
    ),
    template(
      '<v-slider><template #label><span v-tooltip="help">Depth</span></template></v-slider>'
    ),
    template(
      '<div><span>Depth<v-tooltip activator="parent">Help</v-tooltip></span><v-slider /></div>'
    ),
    template(
      '<div><v-slider :disabled="!!reason" /><v-range-slider :disabled="reason" /><v-tooltip activator="parent" :disabled="!reason">{{ reason }}</v-tooltip></div>'
    ),
    template(
      '<v-tooltip><template #activator="{ props }"><v-btn v-bind="props">Help</v-btn></template><v-slider /></v-tooltip>'
    ),
  ],
  invalid: [
    '<v-slider v-tooltip="help" thumb-label />',
    '<VRangeSlider v-tooltip:top="help" />',
    '<input type="range" v-tooltip="help" />',
    '<div v-tooltip="help"><span><v-slider /></span></div>',
    '<ReasonedAction tooltip="Help"><v-range-slider /></ReasonedAction>',
    '<reasoned-action :reason="reason" :tooltip="help"><div><v-slider /></div></reasoned-action>',
    '<v-tooltip><template #activator="{ props }"><span v-bind="props"><VSlider /></span></template>Help</v-tooltip>',
    '<div><v-range-slider /><v-tooltip activator="parent">Help</v-tooltip></div>',
    '<v-slider><v-tooltip :activator="\'parent\'">Help</v-tooltip></v-slider>',
    '<div><v-slider /><v-tooltip v-if="viewingCine" activator="parent">Help</v-tooltip></div>',
    '<div><v-slider :disabled="unrelated" /><v-tooltip activator="parent" :disabled="!reason">Help</v-tooltip></div>',
    '<div><v-slider :disabled="!!reason" /><v-range-slider /><v-tooltip activator="parent" :disabled="!reason">Help</v-tooltip></div>',
  ].map((content) => ({
    code: template(content),
    errors: [{ messageId: 'obscuresValue' }],
  })),
});
