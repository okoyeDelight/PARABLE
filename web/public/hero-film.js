(() => {
  const film = document.querySelector('#filmFrame');
  const stage = document.querySelector('#filmStage');
  const progress = document.querySelector('#filmProgressBar');
  const phase = document.querySelector('#filmPhase');
  const counter = document.querySelector('#filmCounter');
  const play = document.querySelector('#filmPlay');
  const canvas = document.querySelector('#filmFx');
  if (!film || !stage || !progress || !phase || !counter || !play || !canvas) return;

  /* Stage 1 premium pass / Scene 04: real human anchor.
     The supplied portrait is embedded as a small WebP data URI so the preview
     stays self-contained and does not depend on a third-party image host. */
  const directorPortrait = 'data:image/webp;base64,UklGRgAaAABXRUJQVlA4IPQZAACQwQCdASosAfcBPp1Kn0wlpC2tIzCbAbATiWluwE4srcZ3g3CRXwgwgHDehOSruBw3uFMxbU26Af6h5nyu+/x9/j7/H3+Pv8ff4+/x9/j7/H3+Pv8ff4+/x9/j7/H3+Pv8ff4+/x9/j3kU2Xdgy2LBBeR5/vYIolGMkl64c7leNg0RarJ9Yx96uHoyQ9MhZKXFTAJK7B/E4iV7YgGvV8W9rR/gPgQm7/k/E1BPCrtYpkPTId66SDGgnbCnZeKHX4pVlWF8s8e7pad/AeaQucScdAb+Pv3FaCqyg+4bE1lUFEn07vfanva11Pd2O2PBEkSi/c9pJteHy6dGSHo7vz2jcEc+mxi5c/NJfHQfnsbG3voXAbcWpi2KWs+LIwVy6rQAomTntByZ+6aOd6oyQ9GWwvVNOagHXDHBfs8Jwug67Zof466A81+d+dOeM6DEOf6EiZ2WTactC0IuWf2ZDTRwR8EjUQUyHoyS61gU7phXkY7UBDaT3LNYTVkkME8XjcSGnqq10VnQNMZGg/7lIPs1Ff4FkDj1dhLi1sIolGLkCkTVT3eeqejMe53VU17B+Jcra1gQdoVQ7ApcaSPp6EaxUZip9DYNPkGdwrWS0O2Yy+i2CJv3fGMhOdciKyyIEvm3hjScH4KJXVl2MxFtdwGWbxamfqS1WZQaP1FAE0KQcr2sUhb/4dW9ExN3xQR/j7/HpEfhq1uWbQyzJ6sNL7NdrVQJXd/FH1t237RInB2YybU7TmBMfd8YySWFEEak7MyLD+s2XEqQrZHC6RpnnqmxGQ7/0h62i/vS6xepKMZJL2A8xKdTJGgubeenmLyNtZuTLFUKQSZxnw4G/cIr9/fyE2CNO6qCaoVxGSHcw2Ev/5tcXAP556l37TE012s75cpKrSbcLh/KNNRfok1VPm0B60gF9/rhTC2Mi1+UzIAWpMxoj3y+53hMltCX6W///mMz3TXmKWUfSw9RcuVfI7aW2LWDio9lzY1EE8bDgLOvgg11Ilxy7NbCqGVMoPn61cAN74MdyyPk4vB5szWOZhoCIzAS+iJYaeqmACpBXCn+P7s2MfMtqFZChInnUbJAP7tHxzmAjG+3PiOeu4SXPVfXk9jnH2djmOmA40OiBXYdjmFSaf3mPE6+a9/YsUHUkRpgyxFONhCDcsaZby5n+rYt/eUIdHSTeZr5WooF1jWhmSnXCFqe2GSL3msIROOYIX7V+FK0it6LejiV/DgU3u4F6XwzRXOgbX4ushso5R7XNDXJYam8eP6oOiHb+IGCFOIvCp0D6zaFECOBGJAIG80YG+hs/9DYARd10I/nw4SQ6rYNC9YBWCZyKCn21fxDaCfXRYflHnJv72PRUlFIcO1/dEF2Bx7ImGyapBsBlK9feB1gQvtDbqz/FCN0N8hf1lrhBswKA54G/I4hKrxjuUtK6L4Nowwm76cj2vEhsyVd/beAeBlAFLUOrGN5KRoJbelbwrPX+SnQ7ACHeyZ3H07fAUVKqeu7sj1NfsoYfulXTvubsCtlbfnsXAmXFQh+CRH0TE7+o+8zHKNQZhgVdCi/3C5OCOzjDpYyqgJeV3JY9i/qMXrDoTsdTDfd/3d5W/JmR7X5HcUTh/YNLAXDdQutzej2NQamCJnJqpx5wcKb3RGAFgbip3WZl2uIdJbhCtHsEUusgEyhOsczEFmwXutkApR62T10YoOlvaK/HJ86Cv8TMLxfr5WEiGnXh+kYMeKfU6LYtmt4IEARTFXgcENoz9qK3xlGhjbThZ9ZcjS9uq8TzUbHp7IsOGGmR40yYueZVODUVKR8thyS9LzvMyyudksP1CwIC3AAuz9vRxIoZDf2ww9hPtHuBdMmboCCZZoJKgk///5EtoFGNmxNZFlkLt5VbDPgP/rewjrVzexEbMTTFD6/kcvIeollfbPB6f3wivdUZ2quZfWwIz5zjDjIDlc0X06IYBJhDiqE8V/YAk1kgCB7TgERt1IAx8zSN1WuVIjibwypOgYH1nWG3oh33UKJ3Dfi/4F8093dhEu566j5fwGrzNsPm+NpWG841v6AS5sfNAL+mZeWM9s/Cc5RI5DpIAAA/v96MAAAAAAAdeBq23dgOU/EpW6mqPvG4Cm1e5/a1g3Ty/7j16QS+V9gAEtUQpVBGpFmcqOHxz4DB7VMa6sYmi3NuHS/oe9Qu//eWe3nEwCU9w22HEXoJulgH2N0Qxbg8CdKP1tL3On6eycIJC2VimzoUR2SyzNZArCeVnRbIRSc261WrPup4TtXDUwH69P+7UmtSuLiMrBFopxFTodoQN/AnLt5Gj44HpHOKb5Hoq2WJMdPAbc72i6x/auHzy2+7Vyw+gCLvgz79AAapYaBVGfG3WYo2CR/gPW2mNnuhWlSv+2ph8zpva0aV6PoJOd/rlC3VllsXkkG4ZD95bBLdDI/D6D7PmKDrTv5w36Sckdoz7Peowcl0XpZ5nBdhLm15n3OWUw2B0tNiXQgM1oZ3gS/qOUovfSiVD3jqNPRd8jcMZSEEpHsyH+FDEzGr6lK3mUNBWIcNFHlgqD2dIUw16pp9Zej2AJqKMABQlLVu7CiZ1Bi6j/btheZOxZfAIQiLjN8BtmfFVBCmN0rD4t6Etebvat9HBnSr9PUgRQcuqRa/jmpITAvLc9xPO9HgTrO+fo1XEEw7jdTPgVgOLlCT0dQCXJQoZWDhgEu477SB5fgisVbEWkqFT16Mpzm+L1Cff0Sax1fEmW7tX3Cq0HPayG9huOr0GHrCt8atMnYZC7OIl3x4fAvWWO1LLhaNzXqgZgZK5KA+N9YXxD0V5HBaGYAmEpZCiychNqZlzkTqiN+p0rHwz5rB3DgbCDBafv9Ss3Rr1j0B35d8CkYIe+dy/jC4hHSLr1+jQfwi6t2JN+t/3VMADmDOcNYg1gX1qttubwt4+33O9hkfLxiws8FxJ7+bQo+uynGDCWI1j1R0936OPCyP3XAV57O3hdQi9ksEH0ROjYdUGHQ9QTbX9VmvXL6ONYHAnAcr9pnUdxvDlfb6RniQPnfcHpfJAW3WjSgRWHuCgx3aX+ECnknnIgYED25Nh+gc6Org7w00OOhOFY8WHT2JSUFG9BAbFdK+lwFvSFC3jgUb3fWZXVrsl0Hg8QkpQ51RIh+qBDtSzbevQ9h10RonuXWKOJ4sCC/CkaZj8arSmwI68yAWuzVa5lLwzd9JR9yXKyO9j4y0TvoSbE2vO4O5oPs/K7kl768uyVub4RaY/m64DA/fVLgORR62RfdA9l5plPYClBrtsY4pqaQGpX78OnslO1wy1Y63dc0rUnWrsF75AI6juRYNwuKV2/zIkhzlm7QZPT2USiFj3ReOGFsFJ38IhO1zYXo5l9lrLXYdaxx3RWwOm+hkF0thHr4DmJZTNMlttNMsJPIQPlql7QgNJXk1/GqThKzXuY83byFm5pPHbp0vO//SiymHFx6N9mkefLNh3TNzPEMAD5CHmmGFjI7Yx+xLEHKaDeGmAPtmoEJ/MYszpbYQV3Yp2wxDav65AqdxGn65NRzE8jXBP3+Wv6wJFwpIBQhJVCg2+q+gO0h67H3oHJ2F06tUonRPkTzOB+hLHSLb1PLYTMNyU3FBLAqnizXq+M4IbrrT1KXPVasRqb9oad0ATSFKPaA2GWmNIpta6+yiaN15m3FsejHhK9YNrkDASPFAUUYgVZqL4GBeEqxP1/jHCkkRVU4R79z4DeJd+Rce6lYUvAZhX0a+yqwH4aX9Nzml5tfMvRISQsMYAV5Nco2WPwSJbjnDbbxZoaWmnmA/i/u7PqrTPsmez3sQHHqvKnsMTFxforAKsVezJipDSGknkv+wAP/NVMKdp9DrMEuGs8UZEgJcapshy3a9szVUXe3rcblSx6jUeQoMgs/RGW8TiCdIT56hyfebsjZSrtY3QjBFyy63g1NwWvPW+Ftt0jZhIYjoiRAKL1lOPTqe+OIJvSsU7GdMStHQ8eb2/oycNf4qu0C11XcdauWmcUIkkUnqKORejvFDW6FAm7MqzAechCABy1GPqshZJJv8TlBfurYIiZJ+9w2R6zfP2qey8HR0AwszPiQBOVhEPxAQPb1sRn7BKifOOudKhisK4B0aFB5Ea+OTYcX0y2tQaSECSNzjMTXJvHPb+ty3aAD7PPzgS9w9qmWu1KEsc0lZfKtOdrSo+rPQziy0TL4zpl+wIZ09A9FzbkDzNBgrJF7HsG3xHeAxdBs9e6rlkqgCIO12b4DfxFuAHZL+cJhJu7hxAeMDX0a5UcvX7bM8e3RICIf7GQQLCjgRsY2p8KzQlxhPRmL0BpLYAyMeHgNYUHiD3PDlRDSd8ToZ6RsB/PNvWjrIqwuHR0mWCYklOBgCzkx1bzwxIndWtIqcZrxt3ZY+m2Nunw+hULi2mNZazizdAgFBrXDEaUN4tdTc1JjEO8/3n/zpsCOTeuy7ndukkobRb/Z7d6nzS+mc6ZjDmSGr5JMHK7s9Avoif+E78RfndXTOY/davWiQ1bVN4VySVCN6Kmq6cucnhzLmuuFK6Ogm9TpVVOK1koOAjmRfv7n+szlDICE30Kkb6+VtS7lCwUZS0lAXon30UX1vCZKc9UB2RnKuqfdp6mvA9I6kBHpECT64l9KmcszMW2jwuMyYifjk7NjWsnysWR7Z62AUhNBEMuVJGzhgcqFW+Oq/M2EWFSgP3buJIzCmuz6Op1ZRfrYl1EB7h1tEAbMu9zpaAwyE68fRVR8jwSY1e/KSxFSXxpb46QwjUJafmTzSZJT9T2GFW5GdttJbxuo6hpKLjtFOXtkgq2tuddts8QY8jPEFoFvElbwCxqDNupwXPLC2MAkteaFy1PEM3/+lkuHNeaKRHiLCkI9zFc9pWlzv57iGC2ek4amGC0/4t95f3ck3HHXJLbI8ee08g1YnZwaTUE7JvnmO0lnYhM/DCn8gNXy8M5HN0naiUq6rEZNO/bzFUiPpXzH4H1sVfnK71wfbPDb16WfH09VrzHp5YM3Tdn5/o9199NEDrx1EB15f2NP4RhvtDQX1OQWxRVWnT4oV6fHB9mGD/Rnbi+sbDbHHBXjIbi/NQ0mKEuc3ZevbnxMi1v356qv6Q1nxmmR6bsOxd8hKgWv/qZgxAMh3Vc3vJQYpJRTrQvCf5EysQ+bXyVdDjMABhcD1PMYdbFaVMpTNERIQKd0gQXkKbOgu/MepEZ0gGHNsBfXHS1dZ7OR5BKdlceSRT+LWAoLkSGOBot/rzs8GxtfR4fl8raLr60LL9QswI87R6nALf34ObRGailMUEBItCw1SEumabiqo8IcRyhFYIMT6++TJk1a1sogPPoafgikR9F6VR/loMHAVFDoomc1hfsxqwwrkRh71dHt1fsQ2hk1Sitl2w+0u+qXmBP5lRoSBcEA4aGHI5F9ApjUt5BRX6nOf1riqh9rL1D41+IoT5oOvqDsp1bRcfQ3ZXqCiSXecCVnFGsQDQ7hHGN033EARnGGAtgjUapPifV/K14xabXCscYwBQ8f7gD7xMkeyeikAUGtRxk/lY2MVaAyqTAYqK+RPJrVg0FozR3+0m1QYJYkuMNEIy1rE1t48Q43VrIa4X5778wIqrPoqGpyzAh1cD78sdvP4a9PU6rbBrYgqxzixNELS7r5GhC3rc4jfHPinkufgHAab4zcj1byeEKeyarAa2cAhfRZI08qMgj6Y14jkka2rfCTxQxiamiM6WbcYM6Mae4wPPeHGYG9UcYTWjhZF1c+r5tIdJTo9AwCKVKGlL2r9LE2dW0cSVmWfWnlkrAZYnaCf6z0t4jKsanCjFFdEyQX4zWTrc1fgWuMIgIEgFtDhiIY8RQlcnXF02LJy60KUJbFuKz8UVJb0LckvFPZsrJcSB079mTdoF9q+d4g3euDZlkTbtMv0E3WvvFdzi4cu//UmYK6Xbhl8u9y2xnmIxUjSzIJ30ImyfIOrRKsFcEpa4VSYSG9bHLShRwOqpQIFBmbNf82pbLJXF8P1LDNuVAtRSRihZV0FVNeJ8qi+z6+OPJysQcNA3oTsrv+3eM8K7nrOM+N0Strk8V9hFPCZlhNarAMtLwnkPsgXM+EecgnAt+Yf7d67oTo1BSkhSpcQRMCvqS60bKmn6CW2M08x9F1v8y6wSWWo/wxraxvmK6jNELh4HVwFw1we05EszTtN9pf7M0BL6WDplGc+yMSYCKHZMuWmZdUo1JaE/4rpM1KcGJoJad2mdC7H3E7AQVd0DFbCkspsYRMIgazf5d6n5Nf5/PfNueq2k0Sm22ej29RNdnYqTlI+IG2J0uCgTavR0C/2EHtDNvjUe8COibdkrBlmYbVcd5E3IFrmNX6PGjQOtNGHWAKx21AQXDMD7xSkBi2L+sOsDClv6zWkU26NxdhWLdAQvhGRAYYvLiHrhxl5i9LV5jbFYz7Cfgdcf48UH1GH1Vlmfi6gVCC/YB9wqTheM49hPA/k5UfM/SorjXD5MTZG2zay2/Tc64tiQnFLyy9ayjvcnEaDWnz/Q3jD38VAqYaKUcEB5F6TDc8mY7rawLiD8DzRRYxw1pkcc7OwWFf0Q6P/Mi9/wTugIWOsRa0sOdwgwGI1FGS/SLswIQRi9v18C/Pw+DgceVUsB7aCYJeD2RLJIgArODoVW4M7GmezOTY3/ttOSR0TCH4e9HP9Ou25bI5WE7CVsGpuzTFZtDz/XZXXLmJIkvTilb/ihawg5HdDshIiilbd68xF61p1cWcxG3fYCJHeLHURWGRe2vbHwMX4fB01xh24K2SEFOWSuJJG0fSRk7oGVEz+Fodt51ZBo6ghjyjgUTTeGNdgZZXFxd2fYZZqOci+hHWC1c2JU/jMjvfaovvPy7n1FGyujfhUsZjRCMnv8J2t3UDLsX9B9u4nAtMOqauekFPAPVqIiJ1LR8fhM2fe8QAmE9q6XNXdErbgjTy618UvRoT5UUbaDY7W3DdSatqzToJFAoZkgv53SEK7m/bUK77AsYjbzWN3rOcjM/8wvNjLT+GrjGUPKeL9gdeM816ucbQ3uAmwXvSq2Tc8/KlmKIKzlQLvow9Olk69Cl+eblziOihyPx3R6Il3vUMZk2jVG+M6pCQ3PFEIK4U2vRhc1RTcI4IB+WCth5dUv6mAeXMKlj/zYId+AzRqWs6TpDL+/jqo85rtgYnaXA1qzjPXgrqLmpmN+cspoQs8civzGOB0JUKT3fEsE8n3M+Fqv5mXHBfdf8OcjeAldqw7y/OVbr5U6xgfnNsQoG8CPxIA7FE7kFReZaWsNlrQVvAS+04Y2J6qe0l2DJU4n/9gY7h1fw0N2pSZ04LoZocm8w8/ugzO+9Vpk2DX9wEhxOL8UkGluIHgmhVUCbcwzXA1POvIcZVIcM6hsXhrftEfgAwYpc5mE9bYYy+mrxILtICoGAxHmwfXR3Iv3A+mx5x6pTmCgnL6sTY2xx+ngdxeo+h1Ure0bzVgTnDry8ftBtTxT1DSy8Fdk7SIBZpNrT8/9fowjmoeF/nrtu6vpsHwC9Y1KLD6hxzTQnimvbFnRxxAjE6rVMqJsjUSKefvq4nQIZdRQuWs60xPi4gSMAnXUQCaX4/eKCbSYpgLMUjVn6uyJ7B7sgTMKN+A32+qjcN8zZHbCn1LkGnTvCE2nHWKO5GxRQNAZLy2MXcKzBaT6+S7gGFaoTMNzwG9eNxEFxmhlF3HhAMki8esqo9wunEG74XcM+Tcnp3nXJqn/bvCgVcMvyDqhc/WboInbonXpp2+oqLRcr8mJsRqXDOXjTVzHNez8aLQEbeX9bJU2L2oO5MrwE/qqwL6Us+0lsxtLFA4KBfKJAEOFJvGgqNXzutOkBwsB/KayhHOC39q9sEqYvnQhHcYdT5qWJ35abFkp4d0a+MQQSub9T5WvcjQHXxKjJojDMp8Y9LyzTNPWXbVzkNto1R1RMqk6lnk1+nLOC/xLNxU1LsLC9a0JAHl0Sb000NBDzk8ucW6sxiLyKDmYDrwYJ0gAht0WImewgFdx9fLir0R6veVLDvkEd1EO4HSEvFxAZyoB8+lWHFMuRKiJbXwcLpm4/4XWyJGOWx4xB/2hJ1LqXYOIoWF+VONPz2O1Npgc5cEnLgWkZ9xbss6uvLVi6d6KtaISd2uXKAkuynaX0yVXaEFHoKPDKlEOlyaAqB9wQ4TG+pcutlOwfYykMQw0ks0ADuTI0tTFvn0jAWHNGGKKvhPMlEagFoX76gU0NHOrjGci+fFp3/yCoSx3k/HoEvEHs+0TYNrF6abEfsRxRCxRMuNISrHjqS6JnEauB8QuWnZA5bO9Bw9DBdUIS0lHlrmd6/5UZSY1vEkc2nbgoBrwP2JgSiHzGcEg6dNnMIHVwrQsJp9+8qW/6K9lf3bA4HIWBysnH8Oi2iTgsJMUUa7ePhILviwPoa78e8iKCSGjDiTy1/fpavA+w7TTJavczkUVKb3lxfwpnA6B97O0XlS+WUZ2l337WB3UqWjfwYtC/HFcslrueX0FmTdYSJDIHhQrezfZFdbLN2HPjnoRS0hj9TXRmGHbNltEGXb56ktW50mmiKEje80L0O5O61ABMh0USMrDbGVoTlcsAAvC1nElF+gh8VHwqsCEFKU61W7KObaceQXAElXTkCHf4KRbstRpbb/jpgclXKNilz7UCKiiRMizl5GfocK3bu6odzeR/279HwQsexqdryfIPv7WgE9UHtHVw76bbJPsongjDXVAOAt7+CAf9KLXVkLMy4paE/gbXJeohffjMux8bHvSh8v50bAV9lQ5BUO88cksV722U6ePi4QvgoiiBBilquNl84p1biCZ0qtj7mIPKQRAf5aYY5IEKyh+9rYdrslRVmIx7qq5l/r3Itb8av4gTgC2vg28j/Mc9OKYmA1d9CR3ohMAAAAA==';
  const premiumDirectorStyle = document.createElement('style');
  premiumDirectorStyle.textContent = `
    .scene-direct .director-preview{
      background:
        radial-gradient(circle at 76% 24%,rgba(92,124,255,.34),transparent 29%),
        radial-gradient(circle at 40% 70%,rgba(68,82,142,.16),transparent 42%),
        linear-gradient(135deg,#07080d 0%,#111725 54%,#05060a 100%);
    }
    .scene-direct .actor-silhouette{
      width:220px!important;height:330px!important;left:38%!important;bottom:-20px!important;
      border-radius:34px 34px 14px 14px!important;
      background-image:
        linear-gradient(180deg,rgba(6,8,13,0) 54%,rgba(4,6,10,.9) 100%),
        linear-gradient(96deg,rgba(54,78,255,.16),transparent 35%,rgba(137,214,255,.16)),
        url('${directorPortrait}')!important;
      background-size:cover!important;background-position:center 18%!important;background-repeat:no-repeat!important;
      box-shadow:0 26px 70px rgba(0,0,0,.58),-14px 0 42px rgba(72,93,255,.13),16px 0 46px rgba(113,201,255,.10)!important;
      filter:saturate(.72) contrast(1.06) brightness(.88)!important;
      overflow:hidden;
      transform-origin:50% 74%;
    }
    .scene-direct .actor-silhouette::before{
      content:''!important;position:absolute!important;inset:0!important;width:auto!important;height:auto!important;left:0!important;top:0!important;
      border-radius:inherit!important;
      background:linear-gradient(108deg,rgba(75,102,255,.14) 0%,transparent 34%,transparent 61%,rgba(151,222,255,.14) 100%)!important;
      mix-blend-mode:screen;pointer-events:none;
    }
    .scene-direct .actor-silhouette::after{
      content:'';position:absolute;inset:-12% -38%;pointer-events:none;
      background:linear-gradient(112deg,transparent 38%,rgba(255,255,255,.12) 48%,rgba(116,202,255,.14) 52%,transparent 61%);
      transform:translateX(-38%);mix-blend-mode:screen;opacity:.58;
    }
    .scene-direct.is-active .actor-silhouette{
      animation:directorPortraitIn 1.05s cubic-bezier(.16,1,.3,1) both,directorPortraitFloat 4.8s ease-in-out 1.05s infinite alternate;
    }
    .scene-direct.is-active .actor-silhouette::after{animation:directorPortraitSweep 3.7s ease-in-out .45s infinite;}
    .scene-direct .focus-box{
      left:37%!important;top:18%!important;width:205px!important;height:225px!important;
      border-color:rgba(225,234,255,.72)!important;
      box-shadow:0 0 22px rgba(99,130,255,.09),inset 0 0 20px rgba(135,194,255,.025);
    }
    .scene-direct .shot-caption{
      left:18px!important;bottom:17px!important;padding:9px 11px;border-radius:10px;
      background:rgba(7,9,14,.54);border:1px solid rgba(255,255,255,.075);backdrop-filter:blur(13px);
    }
    .scene-direct .director-controls{
      background:linear-gradient(180deg,rgba(15,17,23,.96),rgba(9,11,16,.96))!important;
    }
    @keyframes directorPortraitIn{from{opacity:0;transform:translateY(18px) scale(.94);filter:saturate(.55) contrast(1.02) brightness(.72) blur(5px)}to{opacity:1;transform:translateY(0) scale(1);filter:saturate(.72) contrast(1.06) brightness(.88) blur(0)}}
    @keyframes directorPortraitFloat{from{transform:translateY(0) scale(1)}to{transform:translateY(-4px) scale(1.018)}}
    @keyframes directorPortraitSweep{0%,52%{transform:translateX(-42%);opacity:0}66%{opacity:.62}100%{transform:translateX(42%);opacity:0}}
    @media(max-width:700px){
      .scene-direct .actor-silhouette{width:195px!important;height:292px!important;left:36%!important;bottom:-18px!important;}
      .scene-direct .focus-box{left:34%!important;top:17%!important;width:185px!important;height:205px!important;}
      .scene-direct .shot-caption{left:14px!important;bottom:78px!important;}
    }
  `;
  document.head.appendChild(premiumDirectorStyle);

  const scenes = [...stage.querySelectorAll('.film-scene')];
  const labels = ['Write', 'Understand', 'Shape the world', 'Direct', 'Cut', 'Bring it to screen'];
  const DURATION = 12000;
  const sceneDuration = DURATION / scenes.length;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playing = !reduced;
  let startedAt = performance.now();
  let pausedAt = 0;
  let frameId = 0;
  let activeIndex = -1;
  let pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const ctx = canvas.getContext('2d', { alpha: true });
  let particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resizeCanvas() {
    const r = film.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.floor(r.width));
    height = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles = Array.from({ length: width < 700 ? 22 : 42 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.45 + Math.random() * 1.15,
      a: 0.06 + Math.random() * 0.22,
      s: 0.08 + Math.random() * 0.24,
      o: Math.random() * Math.PI * 2,
      blue: i % 4 !== 0
    }));
  }

  function paintFx(t) {
    ctx.clearRect(0, 0, width, height);
    const g = ctx.createRadialGradient(
      width * (0.55 + pointer.x * 0.04),
      height * (0.45 + pointer.y * 0.03),
      0,
      width * 0.52,
      height * 0.48,
      Math.max(width, height) * 0.68
    );
    g.addColorStop(0, 'rgba(68,93,255,.10)');
    g.addColorStop(.42, 'rgba(75,50,200,.035)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    particles.forEach((p, i) => {
      const x = p.x + Math.sin(t * p.s * .001 + p.o) * 11 + pointer.x * (i % 5) * .5;
      const y = (p.y + t * p.s * .015) % (height + 30) - 15;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.blue ? `rgba(133,158,255,${p.a})` : `rgba(255,255,255,${p.a * .7})`;
      ctx.fill();
    });
  }

  function setScene(index, localProgress = 0) {
    if (index !== activeIndex) {
      activeIndex = index;
      scenes.forEach((scene, i) => {
        scene.classList.toggle('is-active', i === index);
        scene.classList.toggle('is-before', i < index);
        scene.classList.toggle('is-after', i > index);
        scene.setAttribute('aria-hidden', String(i !== index));
      });
      phase.textContent = labels[index];
      counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
      film.dataset.scene = String(index + 1);
    }
    film.style.setProperty('--scene-progress', String(localProgress));
  }

  function tick(now) {
    pointer.x += (pointer.tx - pointer.x) * .055;
    pointer.y += (pointer.ty - pointer.y) * .055;
    film.style.setProperty('--pointer-x', pointer.x.toFixed(3));
    film.style.setProperty('--pointer-y', pointer.y.toFixed(3));
    paintFx(now);

    if (playing) {
      const elapsed = (now - startedAt) % DURATION;
      const index = Math.min(scenes.length - 1, Math.floor(elapsed / sceneDuration));
      const local = (elapsed % sceneDuration) / sceneDuration;
      setScene(index, local);
      progress.style.transform = `scaleX(${elapsed / DURATION})`;
    }
    frameId = requestAnimationFrame(tick);
  }

  function pauseFilm() {
    if (!playing) return;
    playing = false;
    pausedAt = performance.now();
    film.classList.add('paused');
    play.setAttribute('aria-pressed', 'false');
  }

  function playFilm() {
    if (playing) return;
    const now = performance.now();
    startedAt += now - pausedAt;
    playing = true;
    film.classList.remove('paused');
    play.setAttribute('aria-pressed', 'true');
  }

  play.addEventListener('click', () => playing ? pauseFilm() : playFilm());

  film.addEventListener('pointermove', e => {
    if (innerWidth < 720) return;
    const r = film.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - .5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - .5) * 2;
  });
  film.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });

  const observer = new IntersectionObserver(([entry]) => {
    if (!entry) return;
    if (!entry.isIntersecting && playing) pauseFilm();
    if (entry.isIntersecting && !playing && film.dataset.userPaused !== '1' && !reduced) playFilm();
  }, { threshold: .12 });
  observer.observe(film);

  play.addEventListener('click', () => {
    film.dataset.userPaused = playing ? '0' : '1';
  });

  const ro = new ResizeObserver(resizeCanvas);
  ro.observe(film);
  resizeCanvas();
  setScene(0, 0);
  if (reduced) {
    playing = false;
    film.classList.add('paused');
    play.setAttribute('aria-pressed', 'false');
  }
  frameId = requestAnimationFrame(tick);

  window.ParableHeroFilm = {
    setStories(stories = []) {
      const targets = ['#heroCoverA', '#heroCoverB', '#heroCoverC'];
      targets.forEach((selector, index) => {
        const el = document.querySelector(selector);
        if (!el || !stories[index]) return;
        const title = el.querySelector('b');
        if (title) title.textContent = stories[index].title;
      });
      const sceneTitle = document.querySelector('#sceneStoryTitle');
      if (sceneTitle && stories[0]) sceneTitle.textContent = stories[0].title;
    },
    destroy() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      ro.disconnect();
    }
  };
})();